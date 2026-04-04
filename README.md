# MONITORIA-DE-ANATO

Aplicacao de anatomia com gabarito interativo, modo flashcard, deck importado com imagens e suporte opcional a Supabase para salvar o progresso do usuario.

## O que o app faz

- Mostra o gabarito por categorias.
- Permite busca rapida no conteudo.
- Roda flashcards com virada de card.
- Importa o deck do `.zip` com imagens.
- Salva progresso localmente ou no Supabase.
- Mostra painel de progresso, pontos fortes e pontos a reforcar.

## Arquivos principais

- [index.html](index.html)
- [flashcards_import.js](flashcards_import.js)
- [flashcards_assets](flashcards_assets)
- [supabase-config.js](supabase-config.js)
- [supabase/schema.sql](supabase/schema.sql)

## Como ativar o Supabase

1. Crie um projeto no Supabase.
2. Ative login por e-mail com magic link.
3. Abra o editor SQL do Supabase e execute o arquivo [supabase/schema.sql](supabase/schema.sql).
4. Copie a `Project URL` e a `anon key` para [supabase-config.js](supabase-config.js).
5. Abra o app e faca login pelo campo de e-mail no topo da tela.

## Como funciona o progresso

- Sem login: o progresso fica salvo no navegador.
- Com login: o progresso vai para o Supabase e pode ser acessado em outros dispositivos.

## Observacao

Os arquivos de imagem importados do deck estao em [flashcards_assets](flashcards_assets). O deck importado foi convertido em [flashcards_import.js](flashcards_import.js).