# MONITORIA-DE-ANATO

Aplicacao de anatomia com gabarito interativo, modo flashcard, deck importado com imagens e progresso salvo em uma planilha Excel.

## O que o app faz

- Mostra o gabarito por categorias.
- Permite busca rapida no conteudo.
- Roda flashcards com virada de card.
- Importa o deck do `.zip` com imagens.
- Login com e-mail e senha (contas salvas na planilha).
- Salva o progresso de cada usuario em uma aba propria da planilha.
- Mostra painel de progresso, pontos fortes e pontos a reforcar.

## Arquivos principais

- [index.html](index.html) - interface do app
- [server.js](server.js) - servidor que le e grava a planilha
- [flashcards_import.js](flashcards_import.js) e demais `*_import.js` - decks importados
- [flashcards_assets](flashcards_assets) - imagens dos decks

## Como rodar

1. Instale o [Node.js](https://nodejs.org) (versao 18 ou superior).
2. Na pasta do projeto, rode uma vez: `npm install`
3. Inicie o servidor: `npm start`
4. Abra http://localhost:3000 no navegador.

## Como funciona o armazenamento

Todos os dados ficam em `dados/monitoria-dados.xlsx`, criada automaticamente no primeiro cadastro:

- **Aba "Usuarios"**: uma linha por conta (nome, e-mail, senha com hash, aba do usuario, datas).
- **Uma aba por usuario**: cada linha e um flashcard com tentativas, acertos, erros, revisoes e ultima visualizacao.

Para gerenciar o sistema, basta abrir a planilha no Excel. Importante: **feche a planilha antes de os alunos usarem o app** - com o arquivo aberto no Excel, o Windows bloqueia a gravacao e o servidor avisa que nao conseguiu salvar (o progresso fica guardado no navegador do aluno e sincroniza depois).

- Sem login: o progresso fica salvo apenas no navegador.
- Com login: o progresso vai para a planilha e pode ser acessado em outros dispositivos (com o servidor rodando).

A pasta `dados/` nao vai para o GitHub (esta no `.gitignore`), porque contem os dados e senhas dos usuarios.

## Observacao

Os arquivos de imagem importados do deck estao em [flashcards_assets](flashcards_assets). O deck importado foi convertido em [flashcards_import.js](flashcards_import.js).
