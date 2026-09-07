# SOSPlus Server

API inicial em TypeScript para o SOSPlus. Ela usa o banco MySQL `sosplus_01` já criado localmente.

## Como executar

O arquivo `.env` local já aponta para o MySQL do Docker. Para instalar e iniciar:

```bash
npm install
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
