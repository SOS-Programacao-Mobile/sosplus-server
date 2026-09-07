# SOSPlus Server

API em TypeScript para o SOSPlus com MySQL e migrações versionadas.

## Iniciar com Docker (equipe)

Instale e inicie Docker com Compose v2. É necessário acesso ao repositório privado da organização.

```bash
git clone https://github.com/SOS-Programacao-Mobile/sosplus-server.git
cd sosplus-server
docker compose up -d --build --wait
```

O comando cria o MySQL, espera o banco aceitar conexões, aplica as migrações pendentes e inicia a API em http://localhost:3000. Não é necessário instalar Node ou MySQL no computador. Se uma migração falhar, a API não inicia; consulte `docker compose logs api`.

No DataGrip, conecte em `127.0.0.1:3306`, banco `sosplus_01`, usuário `sosplus`, senha padrão `sosplus_dev_local`. Essas credenciais são apenas para desenvolvimento local; as portas são publicadas somente em `127.0.0.1`.

Para personalizar, copie `.env.example` para `.env` antes da primeira execução. Se as portas estiverem ocupadas, altere `MYSQL_PUBLISHED_PORT` e `API_PUBLISHED_PORT`. O `.env` não é enviado ao Git nem à imagem. Alterar senhas no `.env` após inicializar o volume não altera as contas existentes no MySQL.

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
npm run migration:run
npm run dev
```

Em outra janela, teste as primeiras rotas:

```bash
curl http://localhost:3000/
curl http://localhost:3000/api/v1/health
curl http://localhost:3000/api/v1/health/database
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

As migrações seguem o MER do SOSPlus e criam as tabelas `usuarios`, `categorias`, `perfis_doador`, `perfis_ong`, `ong_categorias`, `enderecos_ong`, `seguidores_ong`, `campanhas`, `necessidades`, `doacoes`, `doacoes_itens` e `publicacoes`.

Cada tabela possui sua própria migração. Para adicionar uma tabela ou alterar uma existente, crie uma nova migração com o próximo número, registre-a no arquivo `index.ts` e execute o comando de migração. Nunca altere uma migração que já tenha sido aplicada em outro banco.

O MySQL faz commit implícito de alterações de estrutura. Uma migração com vários comandos pode ficar parcialmente aplicada se falhar; inspecione o banco antes de repetir. O executor usa um bloqueio no MySQL para impedir execuções simultâneas.

## Cadastro e autenticação

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Cadastra usuário e perfil na mesma transação. |
| POST | `/api/v1/auth/login` | Valida e-mail, senha, perfil e conta ativa; retorna sessão. |
| GET | `/api/v1/auth/me` | Retorna o usuário da sessão. |
| POST | `/api/v1/auth/logout` | Revoga a sessão. |

Cadastro de doador:

```json
{
  "tipo": "DOADOR",
  "nome": "Nome do doador",
  "email": "doador@example.com",
  "senha": "uma-senha-segura",
  "confirmacaoSenha": "uma-senha-segura"
}
```

Para ONG, use `"tipo": "ONG"`, informe o nome da organização e acrescente `cnpj`. Nome, e-mail, senha e confirmação são obrigatórios nos dois perfis. A senha deve ter de 8 a 128 caracteres e coincidir exatamente com a confirmação. O e-mail é normalizado para minúsculas e é único entre todos os usuários. CNPJ é obrigatório, normalizado e único para ONGs. CPF de doador é opcional (migração 014).

O CNPJ aceita formato numérico e alfanumérico, com ou sem máscara, validando os dígitos segundo o [manual da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf). Essa validação não consulta a situação cadastral da organização.

No login, envie `email`, `senha` e `tipo`. A resposta contém `token`, `expiresAt` e `usuario` (`id`, `nome`, `email`, `tipo`, `cnpj`). Envie `Authorization: Bearer <token>` nas rotas `/me` e `/logout`. A sessão expira em 24 horas e continua válida entre reinícios do servidor. A migração 015 cria `sessoes`.

Senhas usam scrypt com salt individual. O banco guarda apenas o hash do token de sessão; nunca a confirmação de senha. As respostas públicas não incluem hashes. Cadastro e login têm limite compartilhado de 30 tentativas por IP a cada 15 minutos, em memória por processo. Erros de validação retornam 400, credenciais/sessões inválidas 401, duplicidades 409 e excesso de tentativas 429. Configure HTTPS ao disponibilizar a API fora do desenvolvimento local.

## Testes de autenticação

```bash
npm test
```

O teste de integração exige `RUN_AUTH_INTEGRATION=1` e um banco cujo nome termine em `_test`. Ele aplica as migrações, testa a API com MySQL e remove somente as contas criadas por ele:

```bash
MYSQL_DATABASE=sosplus_auth_test MYSQL_PUBLISHED_PORT=13307 API_PUBLISHED_PORT=13001 \
  docker compose --env-file /dev/null -p sosplus-auth-check up -d --build --wait
RUN_AUTH_INTEGRATION=1 MYSQL_HOST=127.0.0.1 MYSQL_PORT=13307 \
  MYSQL_DATABASE=sosplus_auth_test MYSQL_USER=sosplus MYSQL_PASSWORD=sosplus_dev_local \
  npm run test:integration
```

O app Android usa `10.0.2.2:3000` no emulador. Para celular USB, use `adb reverse tcp:3000 tcp:3000` e compile o app com `-PapiBaseUrl=http://127.0.0.1:3000`. Consulte também o README do aplicativo.
