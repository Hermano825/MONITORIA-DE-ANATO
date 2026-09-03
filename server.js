// Servidor local da Monitoria de Anatomia (rode com: npm start)
// Na Vercel o mesmo aplicativo roda como funcao serverless (ver api/index.js).

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Monitoria de Anatomia rodando em http://localhost:${PORT}`);
  console.log('Dados dos usuarios: pasta dados/ (localmente) ou Vercel Blob (na nuvem).');
});
