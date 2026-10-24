# SOSPlus Server

API em TypeScript para o SOSPlus com MySQL e migrações versionadas.

## Iniciar com Docker (equipe)

Instale e inicie Docker com Compose v2. É necessário acesso ao repositório privado da organização.

```bash
git clone https://github.com/SOS-Programacao-Mobile/sosplus-server.git
cd sosplus-server
cp .env.example .env
# Gere uma chave com `openssl rand -hex 32` e cole em PERSONAL_DATA_ENCRYPTION_KEY no .env
docker compose up -d --build --wait
```

O comando cria o MySQL, espera o banco aceitar conexões, aplica as migrações pendentes e inicia a API em http://localhost:3000. Não é necessário instalar Node ou MySQL no computador. Se uma migração falhar, a API não inicia; consulte `docker compose logs api`.

No DataGrip, conecte em `127.0.0.1:3306`, banco `sosplus_01`, usuário `sosplus`, senha padrão `sosplus_dev_local`. Essas credenciais são apenas para desenvolvimento local; as portas são publicadas somente em `127.0.0.1`.

`PERSONAL_DATA_ENCRYPTION_KEY` é obrigatória, deve ter 32 bytes em hexadecimal ou Base64 e não pode ser enviada ao Git. Guarde-a em um gerenciador de segredos nos ambientes publicados: perdê-la impede recuperar os dados pessoais cifrados. Se as portas estiverem ocupadas, altere `MYSQL_PUBLISHED_PORT` e `API_PUBLISHED_PORT`. O `.env` não é enviado ao Git nem à imagem. Alterar senhas no `.env` após inicializar o volume não altera as contas existentes no MySQL.

## Atualizar o banco de cada colega

Após novas migrações serem enviadas ao GitHub, cada colega executa:

```bash
git pull --ff-only
docker compose up -d --build --wait
```

A imagem reconstruída inclui as novas migrações. Ao iniciar, a API consulta `schema_migrations` e aplica apenas as pendentes, em ordem. Cada colega tem seu próprio banco e dados. O Git compartilha código e estrutura; não sincroniza registros nem atualiza computadores automaticamente.

```bash
# Consultar histórico
docker compose exec api node dist/database/migrations/status.js
# Aplicar manualmente, se necessário
docker compose run --rm api node dist/database/migrations/run.js
# Acompanhar a API
docker compose logs -f api
# Parar sem apagar dados
docker compose down
```

Os dados ficam no volume `mysql_data` do projeto e sobrevivem a reconstruções e ao `down`. `docker compose down -v` apaga o volume e seus dados.

O MySQL criado anteriormente fora deste Compose permanece separado. Use portas alternativas se ambos precisarem rodar; não remova seu volume antigo para adotar este ambiente.

## Como executar

Para desenvolver com Node no computador, configure `.env` para um MySQL disponível:

```bash
npm ci
npm run migration:preflight
npm run migration:run
npm run migration:cpf-backfill
npm run build
npm start
```

Quando o MySQL do SOSPlus já estiver ativo no Docker e publicar a porta `3306` em `127.0.0.1`, a API pode rodar diretamente no computador. Configure o `.env` local para esse banco e use a porta padrão `3000`. Antes de migrar um banco legado, faça backup e rode `migration:preflight`; ele informa IDs e tipos de conflito sem imprimir dados pessoais. Após aplicar migrações, `migration:cpf-backfill` cifra CPFs legados, cria o índice HMAC e limpa a coluna antiga, podendo ser repetido com segurança. O comando exige `PERSONAL_DATA_ENCRYPTION_KEY` configurada. `npm start` executa o código compilado em `dist`; para recompilar durante o desenvolvimento, execute `npm run build` antes de iniciar. Não suba um segundo MySQL na porta 3306.

Em outra janela, teste as primeiras rotas:

```bash
curl http://localhost:3000/
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/health/database
```

Durante o desenvolvimento, a API registra cada requisição e cada consulta SQL em uma
linha no formato `data nível mensagem chave=valor`:

```text
2026-09-22T12:30:15Z INFO Requisição concluída request_id=abc metodo=POST rota=/api/v1/auth/login status=200 duracao_ms=84.2
2026-09-22T12:30:15Z DEBUG SQL executado request_id=abc operacao=execute sql="SELECT ... WHERE u.email = '<string:18 caracteres>' LIMIT 1" linhas_retornadas=1 duracao_ms=3.1
```

`LOG_LEVEL` aceita `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` e `FATAL`. O padrão é
`DEBUG` em desenvolvimento e `INFO` em produção; as consultas SQL normais aparecem em
`DEBUG` e falhas SQL aparecem sempre em `ERROR`. O SQL é montado com os parâmetros em
suas posições, mas os valores são resumidos para não expor senhas, tokens, fotos,
coordenadas ou dados pessoais. Use `LOG_HTTP=false` ou `LOG_SQL=false` no `.env` para
desligar cada grupo. O campo `request_id` é enviado pelo app e aparece tanto no Logcat
quanto nos logs HTTP e SQL do backend, permitindo acompanhar uma chamada de ponta a
ponta.

No Android, as chamadas HTTP aparecem somente na variante debug. Para acompanhar:

```bash
adb logcat -s SOSPlus-HTTP
```

## Rotas iniciais

| Método | Rota | Finalidade |
| --- | --- | --- |
| GET | `/` | Confirma que a API está ativa. |
| GET | `/api/v1/health` | Estado da API. |
| GET | `/api/v1/health/database` | Confirma a conexão com o MySQL. |

As próximas rotas do app devem ficar em `src/routes` e usar a conexão exportada por `src/database/mysql.ts`.

## Migrações do banco

As alterações de estrutura do MySQL ficam em `src/database/migrations`. Cada arquivo possui um ID único e é executado uma única vez. As migrações aplicadas são registradas na tabela `schema_migrations`.

```bash
# Exibe o que já foi aplicado e o que está pendente
npm run migration:status

# Cria/atualiza as tabelas pendentes
npm run migration:run
```

As migrações seguem o MER do SOSPlus e criam as tabelas `usuarios`, `localizacoes_usuario`, `fotos_perfil`, `dados_pessoais_usuario`, `categorias`, `perfis_doador`, `perfis_ong`, `ong_categorias`, `enderecos_ong`, `seguidores_ong`, `campanhas`, `necessidades`, `doacoes`, `doacoes_itens` e `publicacoes`.

Cada tabela possui sua própria migração. Para adicionar uma tabela ou alterar uma existente, crie uma nova migração com o próximo número, registre-a no arquivo `index.ts` e execute o comando de migração. Nunca altere uma migração que já tenha sido aplicada em outro banco.

O MySQL faz commit implícito de alterações de estrutura. Uma migração com vários comandos pode ficar parcialmente aplicada se falhar; inspecione o banco antes de repetir. O executor usa um bloqueio no MySQL para impedir execuções simultâneas.

## Cadastro e autenticação

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Cadastra usuário e perfil na mesma transação. |
| POST | `/api/v1/auth/login` | Valida e-mail, senha, perfil e conta ativa; retorna sessão. |
| GET | `/api/v1/auth/me` | Retorna o usuário da sessão. |
| PUT | `/api/v1/auth/localizacao` | Salva a última localização aproximada do usuário autenticado. |
| GET/PUT | `/api/v1/auth/foto-perfil` | Consulta ou substitui a foto de perfil. |
| GET/PUT | `/api/v1/auth/dados-pessoais` | Consulta ou atualiza o cadastro pessoal cifrado do doador. |
| PUT | `/api/v1/auth/senha` | Redefine a senha após validar a senha atual. |
| POST | `/api/v1/auth/logout` | Revoga a sessão. |

Cadastro de doador (CPF opcional):

```json
{
  "tipo": "DOADOR",
  "nome": "Nome do doador",
  "email": "doador@example.com",
  "cpf": "529.982.247-25",
  "senha": "uma-senha-segura",
  "confirmacaoSenha": "uma-senha-segura"
}
```

Para ONG, use `"tipo": "ONG"`, informe o nome da organização e acrescente `cnpj`. Nome, e-mail, senha e confirmação são obrigatórios nos dois perfis. A senha deve ter de 8 a 128 caracteres e coincidir exatamente com a confirmação. O e-mail é normalizado para minúsculas e é único entre todos os usuários. CNPJ é obrigatório, normalizado e único para ONGs. CPF de doador é opcional, validado e cifrado; um HMAC com chave da aplicação garante unicidade sem armazenar o CPF em texto (migrações 014 e 019).

O CNPJ aceita formato numérico e alfanumérico, com ou sem máscara, validando os dígitos segundo o [manual da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf). Essa validação não consulta a situação cadastral da organização.

No login, envie `email`, `senha` e `tipo`. A resposta contém `token`, `expiresAt` e `usuario` (`id`, `nome`, `email`, `tipo`, `cnpj`, `localizacao`). Envie `Authorization: Bearer <token>` nas rotas `/me`, `/localizacao` e `/logout`. A sessão expira em 24 horas e continua válida entre reinícios do servidor. A migração 015 cria `sessoes`.

`PUT /api/v1/auth/localizacao` recebe `cidade`, `estado`, `latitude` e `longitude`. A tabela `localizacoes_usuario` mantém somente o último ponto aproximado de cada usuário e a data de atualização; ela é atualizada em cada login pelo aplicativo quando a permissão de localização aproximada for concedida.

`PUT /api/v1/auth/foto-perfil` recebe diretamente uma imagem JPEG, PNG ou WebP de até 1 MB e mantém uma foto por usuário na tabela `fotos_perfil`. `PUT /api/v1/auth/senha` recebe `senhaAtual`, `novaSenha` e `confirmacaoSenha`; ao alterar a senha, as outras sessões do usuário são revogadas.

`POST /api/v1/imagens` recebe conteúdo JPEG, PNG ou WebP de até 1 MB e o cabeçalho `X-Image-Purpose` (`PERFIL_ONG`, `CAPA_ONG`, `CAMPANHA`, `NECESSIDADE`, `PUBLICACAO` ou `DOACAO_ITEM`). A resposta contém o ID da imagem local. `GET /api/v1/imagens/:id` permite baixar arquivo do próprio usuário, vinculado a conteúdo público ativo ou, para fotos de itens, às partes da doação. Imagens não vinculadas não ficam públicas.

## Campanhas e carteira simulada

Campanhas são criadas pela ONG como `RASCUNHO`, editáveis enquanto rascunho, e podem ser publicadas (`ATIVA`), encerradas ou canceladas conforme as transições permitidas. `GET /api/v1/campanhas` lista campanhas públicas com continuação; `GET /api/v1/campanhas/minhas` lista as da ONG autenticada. A API prioriza cidade/UF quando informadas e usa somente arrecadações `CONFIRMADA` no total.

`GET/PUT /api/v1/carteira` consulta ou define `saldoCentavos` do próprio doador. `POST /api/v1/doacoes` cria uma intenção pendente e exige `Idempotency-Key`; repetir chave e dados retorna a mesma intenção, e a mesma chave com dados diferentes dá conflito. `POST /api/v1/doacoes/:id/confirmar` debita o saldo fictício uma única vez; `POST /api/v1/doacoes/:id/cancelar` cancela somente pendências. `GET /api/v1/doacoes` e `GET /api/v1/doacoes/:id` expõem apenas o histórico do doador autenticado.

Este saldo é exclusivamente de demonstração: não existe pagamento, transferência, cobrança, reembolso ou integração com bancos/serviços financeiros externos. Exemplo: definir R$ 100,00 (`10000` centavos), confirmar contribuição de R$ 30,00 (`3000`) e consultar saldo de R$ 70,00 (`7000`); a campanha passa a mostrar R$ 30,00 arrecadados. Valores e comprovantes não representam dinheiro real.

## Necessidades e doação de materiais

ONGs criam e cancelam necessidades por `POST /api/v1/necessidades`, `GET /api/v1/necessidades/minhas` e `PATCH /api/v1/necessidades/:id/status`. A lista pública `GET /api/v1/necessidades` mostra apenas necessidades ativas e suas quantidades solicitada, entregue, reservada e restante.

Doadores registram intenção em `POST /api/v1/doacoes-itens`, escolhendo `ENTREGA_NA_ONG` ou `RETIRADA`; `observacao`, `imagemId` e `dataEntrega` são opcionais. `GET /api/v1/doacoes-itens/minhas` e `/recebimentos` são restritos ao doador e à ONG relacionados. A ONG aceita (`ACEITA`) e marca a intenção aceita como entregue (`ENTREGUE`); as partes podem cancelar antes da entrega. Reservas concorrentes são serializadas para não ultrapassar a quantidade. Ao atingir o total, a necessidade passa a `ATENDIDA`; cancelar a necessidade cancela intenções abertas sem apagar entregas concluídas. Cada intenção é entregue integralmente, sem entrega parcial.

## Seguidores, publicações e painel

Doadores autenticados seguem ou deixam de seguir uma ONG por `POST`/`DELETE /api/v1/ongs/:id/seguir`; o vínculo composto impede duplicatas. `POST /api/v1/publicacoes` permite à ONG criar texto com imagem local opcional e campanha própria opcional. `GET /api/v1/publicacoes/minhas` lista suas publicações. `GET /api/v1/feed` retorna somente conteúdo das ONGs seguidas pelo doador, do mais recente para o mais antigo, com cursor por data/ID. `GET /api/v1/ongs/dashboard` retorna campanhas vigentes, encerradas, contagem de contribuições confirmadas e total confirmado em centavos fictícios.

`PUT /api/v1/auth/dados-pessoais` aceita nome, sobrenome, CPF, data de nascimento, endereço, tipo sanguíneo, gênero e telefone. Os campos detalhados são cifrados com AES-256-GCM e autenticação vinculada ao usuário e ao nome do campo. O nome completo também atualiza o nome de exibição do perfil. A chave fica fora do banco em `PERSONAL_DATA_ENCRYPTION_KEY`.

Senhas usam scrypt com salt individual. O banco guarda apenas o hash do token de sessão; nunca a confirmação de senha. As respostas públicas não incluem hashes. Cadastro e login têm limite compartilhado de 30 tentativas por IP a cada 15 minutos, em memória por processo. Erros de validação retornam 400, credenciais/sessões inválidas 401, duplicidades 409 e excesso de tentativas 429. Configure HTTPS ao disponibilizar a API fora do desenvolvimento local.

## Doações do usuário

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/v1/usuarios/{id}/doacoes` | Histórico de doações financeiras do doador autenticado. |

Exige `Authorization: Bearer <token>`. O `{id}` precisa ser o do próprio usuário da sessão (403 caso contrário), e apenas doadores possuem histórico. A resposta traz até 500 doações, das mais recentes para as mais antigas, em `doacoes`: `id`, `ong` (`id`, `nome`), `campanha` (`id`, `titulo`), `valorCentavos`, `data` (`AAAA-MM-DD`), `status` (`PENDENTE`, `CONFIRMADA` ou `CANCELADA`) e `anonima`.

## Recuperação de senha local e dados opcionais

O Compose inclui uma caixa Mailpit sem relay externo. Para usar o MySQL já existente e a API no computador, inicie somente a caixa com `docker compose up -d mailpit`, aplique as migrações e configure `RECOVERY_ENABLED=true`, `SMTP_HOST=127.0.0.1` e `SMTP_PORT=1025` no `.env`. Reinicie a API. A caixa fica em [localhost:8025](http://localhost:8025); as portas SMTP e web ficam em loopback e podem ser alteradas por `SMTP_PUBLISHED_PORT` e `MAILPIT_WEB_PUBLISHED_PORT` (ajuste `SMTP_PORT` junto).

`POST /api/v1/auth/recuperacao` recebe `email` e responde uniformemente. A mensagem contém código aleatório de uso único, válido por 15 minutos, armazenado só como hash. `POST /api/v1/auth/recuperacao/confirmar` recebe `email`, `codigo`, `novaSenha` e `confirmacaoSenha`; o sucesso revoga as sessões. Há limites de 5 solicitações e 10 confirmações por IP/15 minutos e 5 erros por código. O fluxo fica desabilitado sem configuração e não pode ser ativado em produção nesta entrega. Nunca publique a caixa local.

`npm run seed:reference` acrescenta categorias por nome sem duplicação. `npm run seed:demo` é opcional e cria duas ONGs, campanhas, necessidades, publicações e um doador com R$ 100 fictícios. Tudo aparece como `[DEMO]`. As contas são `demo.ong@sosplus.example.test`, `demo.ong2@sosplus.example.test` e `demo.doador@sosplus.example.test`, com senha de demonstração `SosPlus-Demo-123!`. Repetir a carga não altera contas existentes nem seus saldos; `NODE_ENV=production` bloqueia o seed de demonstração. Nenhum seed roda no início da API ou do app.

## Executar testes

```bash
npm test
```

O teste de integração exige `RUN_AUTH_INTEGRATION=1` e um banco cujo nome termine em `_test`. Ele aplica as migrações, testa a API com MySQL e remove somente as contas criadas por ele:

```bash
export PERSONAL_DATA_ENCRYPTION_KEY="$(openssl rand -hex 32)"
MYSQL_DATABASE=sosplus_auth_test MYSQL_PUBLISHED_PORT=13307 API_PUBLISHED_PORT=13001 \
  docker compose --env-file /dev/null -p sosplus-auth-check up -d --build --wait
RUN_AUTH_INTEGRATION=1 MYSQL_HOST=127.0.0.1 MYSQL_PORT=13307 \
  MYSQL_DATABASE=sosplus_auth_test MYSQL_USER=sosplus MYSQL_PASSWORD=sosplus_dev_local \
  npm run test:integration
```

O app Android usa `10.0.2.2:3000` no emulador. Para celular USB, use `adb reverse tcp:3000 tcp:3000` e compile o app com `-PapiBaseUrl=http://127.0.0.1:3000`. Consulte também o README do aplicativo.
