// Aplicativo da Monitoria de Anatomia
// Login e progresso dos usuarios ficam salvos em uma planilha Excel:
//  - rodando localmente (npm start): arquivo dados/monitoria-dados.xlsx
//  - rodando na Vercel: mesma planilha, guardada no Vercel Blob (Storage do projeto)
// Aba "Usuarios" = contas cadastradas. Cada usuario ganha uma aba propria com o progresso.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');

const DATA_DIR = path.join(__dirname, 'dados');
const XLSX_LOCAL_PATH = path.join(DATA_DIR, 'monitoria-dados.xlsx');
const XLSX_BLOB_PATH = 'monitoria-dados.xlsx';
const SECRET_LOCAL_PATH = path.join(DATA_DIR, 'segredo.txt');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 dias

// Na Vercel, o Blob conectado ao projeto expõe BLOB_STORE_ID (auth via OIDC)
// ou BLOB_READ_WRITE_TOKEN (token classico). O SDK detecta os dois sozinho.
const USANDO_BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const SECRET_BLOB_PATH = 'segredo-sessao.txt';

const USERS_SHEET = 'Usuarios';
const USERS_HEADERS = ['Nome', 'Email', 'SenhaHash', 'Sal', 'Aba', 'CriadoEm', 'UltimoAcesso'];
const PROGRESS_HEADERS = [
  'ChaveCard', 'Baralho', 'Titulo', 'CategoriaIndice', 'Categoria', 'Fonte',
  'Tentativas', 'Acertos', 'Erros', 'Revisar', 'UltimoResultado', 'UltimaVisualizacao'
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.richText)) return value.richText.map(part => part.text).join('');
    if (value.result !== undefined) return String(value.result);
    return String(value);
  }
  return String(value);
}

function cellNumber(value) {
  const parsed = Number(cellText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hashPassword(senha, sal) {
  return crypto.scryptSync(senha, sal, 64).toString('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Nome de aba valido no Excel: max 31 chars, sem \ / * ? : [ ]
function sheetNameFromUser(nome, workbook) {
  const base = String(nome)
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[\\/*?:\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 27) || 'Usuario';

  let candidate = base;
  let counter = 2;
  while (workbook.getWorksheet(candidate) || candidate === USERS_SHEET) {
    candidate = `${base.slice(0, 27)} ${counter}`;
    counter += 1;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Armazenamento do arquivo .xlsx (disco local ou Vercel Blob)
// ---------------------------------------------------------------------------

async function readXlsxBuffer() {
  if (USANDO_BLOB) {
    const { get } = require('@vercel/blob');
    const result = await get(XLSX_BLOB_PATH, { access: 'private', useCache: false });
    if (!result || result.statusCode === 404) return null;
    if (result.statusCode !== 200) {
      throw new Error('Nao foi possivel ler a planilha no storage (' + result.statusCode + ').');
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  if (!fs.existsSync(XLSX_LOCAL_PATH)) return null;
  return fs.readFileSync(XLSX_LOCAL_PATH);
}

async function writeXlsxBuffer(buffer) {
  if (USANDO_BLOB) {
    const { put } = require('@vercel/blob');
    await put(XLSX_BLOB_PATH, buffer, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = XLSX_LOCAL_PATH + '.tmp';
  fs.writeFileSync(tmpPath, buffer);
  try {
    fs.renameSync(tmpPath, XLSX_LOCAL_PATH);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
      const lockError = new Error('A planilha parece estar aberta no Excel. Feche o arquivo e tente de novo.');
      lockError.statusCode = 503;
      throw lockError;
    }
    throw err;
  }
}

async function loadWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const buffer = await readXlsxBuffer();
  if (buffer) {
    await workbook.xlsx.load(buffer);
  }
  let users = workbook.getWorksheet(USERS_SHEET);
  if (!users) {
    users = workbook.addWorksheet(USERS_SHEET);
    users.addRow(USERS_HEADERS);
    users.getRow(1).font = { bold: true };
    users.columns = USERS_HEADERS.map(header => ({ width: header === 'Email' ? 32 : 22 }));
  }
  return workbook;
}

async function saveWorkbook(workbook) {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await writeXlsxBuffer(buffer);
}

function findUserRow(workbook, email) {
  const users = workbook.getWorksheet(USERS_SHEET);
  const target = String(email).trim().toLowerCase();
  let found = null;
  users.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || found) return;
    if (cellText(row.getCell(2).value).trim().toLowerCase() === target) {
      found = row;
    }
  });
  return found;
}

function userFromRow(row) {
  return {
    nome: cellText(row.getCell(1).value),
    email: cellText(row.getCell(2).value).trim().toLowerCase(),
    senhaHash: cellText(row.getCell(3).value),
    sal: cellText(row.getCell(4).value),
    aba: cellText(row.getCell(5).value)
  };
}

function readProgressSheet(workbook, sheetName) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const entries = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cardKey = cellText(row.getCell(1).value);
    if (!cardKey) return;
    entries.push({
      cardKey,
      deckSlug: cellText(row.getCell(2).value),
      cardTitle: cellText(row.getCell(3).value),
      categoryIndex: cellNumber(row.getCell(4).value),
      categoryLabel: cellText(row.getCell(5).value),
      sourceLabel: cellText(row.getCell(6).value),
      attempts: cellNumber(row.getCell(7).value),
      rightCount: cellNumber(row.getCell(8).value),
      wrongCount: cellNumber(row.getCell(9).value),
      reviewCount: cellNumber(row.getCell(10).value),
      lastResult: cellText(row.getCell(11).value) || null,
      lastSeenAt: cellText(row.getCell(12).value) || null
    });
  });
  return entries;
}

function upsertProgressEntries(workbook, sheetName, entries) {
  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(PROGRESS_HEADERS);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = PROGRESS_HEADERS.map(header => ({
      width: header === 'Titulo' ? 60 : header === 'Categoria' ? 26 : 18
    }));
  }

  const rowByKey = new Map();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const key = cellText(row.getCell(1).value);
    if (key) rowByKey.set(key, row);
  });

  for (const entry of entries) {
    const values = [
      String(entry.cardKey || ''),
      String(entry.deckSlug || ''),
      String(entry.cardTitle || ''),
      Number(entry.categoryIndex) || 0,
      String(entry.categoryLabel || ''),
      String(entry.sourceLabel || ''),
      Number(entry.attempts) || 0,
      Number(entry.rightCount) || 0,
      Number(entry.wrongCount) || 0,
      Number(entry.reviewCount) || 0,
      entry.lastResult ? String(entry.lastResult) : '',
      entry.lastSeenAt ? String(entry.lastSeenAt) : ''
    ];
    if (!values[0]) continue;

    const existing = rowByKey.get(values[0]);
    if (existing) {
      values.forEach((value, index) => {
        existing.getCell(index + 1).value = value;
      });
    } else {
      const added = sheet.addRow(values);
      rowByKey.set(values[0], added);
    }
  }
}

// Serializa as operacoes na planilha para evitar escrita concorrente no mesmo processo.
let workbookQueue = Promise.resolve();
function withWorkbook(mutates, task) {
  const run = workbookQueue.then(async () => {
    const workbook = await loadWorkbook();
    const result = await task(workbook);
    if (mutates) await saveWorkbook(workbook);
    return result;
  });
  workbookQueue = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------------------
// Sessoes: tokens assinados (HMAC), sem estado no servidor
// ---------------------------------------------------------------------------

let cachedSecret = null;

async function lerSegredoDoBlob() {
  const { get } = require('@vercel/blob');
  const result = await get(SECRET_BLOB_PATH, { access: 'private', useCache: false });
  if (result && result.statusCode === 200) {
    return (await new Response(result.stream).text()).trim();
  }
  return null;
}

// Garante o segredo usado para assinar os tokens de sessao. Na nuvem ele fica
// guardado no proprio Blob (segredo-sessao.txt); localmente em dados/segredo.txt.
async function ensureSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET) {
    cachedSecret = process.env.SESSION_SECRET;
    return cachedSecret;
  }
  if (USANDO_BLOB) {
    const existente = await lerSegredoDoBlob();
    if (existente) {
      cachedSecret = existente;
      return cachedSecret;
    }
    const novo = crypto.randomBytes(32).toString('hex');
    try {
      const { put } = require('@vercel/blob');
      await put(SECRET_BLOB_PATH, novo, {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'text/plain'
      });
      cachedSecret = novo;
    } catch {
      // Outra instancia pode ter criado o segredo ao mesmo tempo: usa o que ficou salvo.
      const salvo = await lerSegredoDoBlob();
      if (!salvo) throw new Error('Nao foi possivel preparar o segredo de sessao no storage.');
      cachedSecret = salvo;
    }
    return cachedSecret;
  }
  try {
    cachedSecret = fs.readFileSync(SECRET_LOCAL_PATH, 'utf8').trim();
  } catch {
    cachedSecret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_LOCAL_PATH, cachedSecret, 'utf8');
  }
  return cachedSecret;
}

function getSecret() {
  if (!cachedSecret) throw new Error('Segredo de sessao ainda nao carregado.');
  return cachedSecret;
}

function assinar(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function criarToken(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + SESSION_TTL_MS
  })).toString('base64url');
  return payload + '.' + assinar(payload);
}

function validarToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!safeEqual(assinar(payload), sig)) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!dados.email || !dados.exp || Date.now() > dados.exp) return null;
    return { email: String(dados.email).toLowerCase() };
  } catch {
    return null;
  }
}

function sessionEmail(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  return validarToken(token);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '2mb' }));

function apiError(res, statusCode, message) {
  res.status(statusCode).json({ erro: message });
}

// Carrega o segredo de sessao antes de qualquer rota da API.
app.use('/api', async (_req, res, next) => {
  try {
    await ensureSecret();
    next();
  } catch (err) {
    apiError(res, 500, err.message || 'Nao foi possivel preparar o servidor.');
  }
});

app.post('/api/registrar', async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');

  if (!nome) return apiError(res, 400, 'Digite seu nome para criar a conta.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return apiError(res, 400, 'Digite um e-mail valido.');
  if (senha.length < 6) return apiError(res, 400, 'A senha precisa ter pelo menos 6 caracteres.');

  try {
    const user = await withWorkbook(true, async (workbook) => {
      if (findUserRow(workbook, email)) {
        const err = new Error('Esse e-mail ja possui conta. Use a aba Entrar.');
        err.statusCode = 409;
        throw err;
      }
      const sal = crypto.randomBytes(16).toString('hex');
      const aba = sheetNameFromUser(nome, workbook);
      const users = workbook.getWorksheet(USERS_SHEET);
      users.addRow([nome, email, hashPassword(senha, sal), sal, aba, new Date().toISOString(), new Date().toISOString()]);
      upsertProgressEntries(workbook, aba, []);
      return { nome, email, aba };
    });

    res.json({ token: criarToken(user.email), nome: user.nome, email: user.email });
  } catch (err) {
    apiError(res, err.statusCode || 500, err.message || 'Nao foi possivel criar a conta.');
  }
});

app.post('/api/entrar', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  if (!email || !senha) return apiError(res, 400, 'Informe e-mail e senha.');

  try {
    const user = await withWorkbook(false, async (workbook) => {
      const row = findUserRow(workbook, email);
      if (!row) {
        const err = new Error('Conta nao encontrada. Abra a aba Criar conta.');
        err.statusCode = 404;
        throw err;
      }
      const data = userFromRow(row);
      if (!safeEqual(hashPassword(senha, data.sal), data.senhaHash)) {
        const err = new Error('Senha incorreta. Tente novamente.');
        err.statusCode = 401;
        throw err;
      }
      return data;
    });

    // Atualiza o UltimoAcesso sem bloquear o login caso a gravacao falhe.
    withWorkbook(true, async (workbook) => {
      const row = findUserRow(workbook, email);
      if (row) row.getCell(7).value = new Date().toISOString();
    }).catch(() => {});

    res.json({ token: criarToken(user.email), nome: user.nome, email: user.email });
  } catch (err) {
    apiError(res, err.statusCode || 500, err.message || 'Nao foi possivel entrar.');
  }
});

app.post('/api/sair', (_req, res) => {
  // Tokens sao assinados e expiram sozinhos; sair = descartar o token no navegador.
  res.json({ ok: true });
});

app.get('/api/sessao', async (req, res) => {
  const session = sessionEmail(req);
  if (!session) return apiError(res, 401, 'Sessao expirada. Faca login novamente.');
  try {
    const user = await withWorkbook(false, async (workbook) => {
      const row = findUserRow(workbook, session.email);
      if (!row) {
        const err = new Error('Conta nao encontrada na planilha.');
        err.statusCode = 401;
        throw err;
      }
      return userFromRow(row);
    });
    res.json({ nome: user.nome, email: user.email });
  } catch (err) {
    apiError(res, err.statusCode || 500, err.message || 'Nao foi possivel validar a sessao.');
  }
});

app.get('/api/progresso', async (req, res) => {
  const session = sessionEmail(req);
  if (!session) return apiError(res, 401, 'Sessao expirada. Faca login novamente.');
  try {
    const entries = await withWorkbook(false, async (workbook) => {
      const row = findUserRow(workbook, session.email);
      if (!row) {
        const err = new Error('Conta nao encontrada na planilha.');
        err.statusCode = 401;
        throw err;
      }
      return readProgressSheet(workbook, userFromRow(row).aba);
    });
    res.json({ entradas: entries });
  } catch (err) {
    apiError(res, err.statusCode || 500, err.message || 'Nao foi possivel ler o progresso.');
  }
});

app.post('/api/progresso', async (req, res) => {
  const session = sessionEmail(req);
  if (!session) return apiError(res, 401, 'Sessao expirada. Faca login novamente.');
  const entries = Array.isArray(req.body?.entradas) ? req.body.entradas : [];
  if (!entries.length) return res.json({ ok: true, salvos: 0 });

  try {
    await withWorkbook(true, async (workbook) => {
      const row = findUserRow(workbook, session.email);
      if (!row) {
        const err = new Error('Conta nao encontrada na planilha.');
        err.statusCode = 401;
        throw err;
      }
      upsertProgressEntries(workbook, userFromRow(row).aba, entries);
    });
    res.json({ ok: true, salvos: entries.length });
  } catch (err) {
    apiError(res, err.statusCode || 500, err.message || 'Nao foi possivel salvar o progresso.');
  }
});

app.use(express.static(__dirname, { extensions: ['html'] }));

module.exports = app;
