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
