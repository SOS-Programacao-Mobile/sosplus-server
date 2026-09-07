import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

// Nunca executa contra o banco normal. Informe explicitamente um banco *_test.
test('cadastro, persistência, login, sessão e logout para doador e ONG', {
  skip: process.env.RUN_AUTH_INTEGRATION !== '1'
}, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  const { app } = await import('../dist/app.js');
  const { database, closeDatabase } = await import('../dist/database/mysql.js');
  const { runMigrations } = await import('../dist/database/migrations/migrator.js');
  await runMigrations();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
  const suffix = randomBytes(6).toString('hex');
  const emails = [`doador-${suffix}@example.test`, `ong-${suffix}@example.test`, `rollback-${suffix}@example.test`];
  const call = async (path, body, token) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  try {
    for (const [index, tipo] of ['DOADOR', 'ONG'].entries()) {
      const body = { tipo, nome: `Cadastro ${tipo}`, email: emails[index], senha: 'Teste-seguro-123', confirmacaoSenha: 'Teste-seguro-123', cnpj: '11.222.333/0001-81' };
      for (const field of ['nome', 'email', 'senha', 'confirmacaoSenha', ...(tipo === 'ONG' ? ['cnpj'] : [])]) {
        assert.equal((await call('/register', { ...body, [field]: '' })).status, 400);
      }
      assert.equal((await call('/register', { ...body, confirmacaoSenha: 'diferente' })).status, 400);
      const registered = await call('/register', body);
      assert.equal(registered.status, 201);
      assert.equal(registered.body.usuario.nome, body.nome);
      assert.equal('senha_hash' in registered.body.usuario, false);
      const [stored] = await database.execute('SELECT senha_hash FROM usuarios WHERE email = ?', [body.email]);
      assert.match(stored[0].senha_hash, /^scrypt-v1\$/);
      assert.notEqual(stored[0].senha_hash, body.senha);
      assert.equal((await call('/register', body)).status, 409);
      if (tipo === 'ONG') {
        assert.equal((await call('/register', { ...body, email: emails[2] })).status, 409);
        const [orphan] = await database.execute('SELECT id FROM usuarios WHERE email = ?', [emails[2]]);
        assert.equal(orphan.length, 0, 'CNPJ duplicado deve reverter também a criação de usuário');
      }
      assert.equal((await call('/login', { ...body, senha: 'incorreta' })).status, 401);
      assert.equal((await call('/login', { ...body, tipo: tipo === 'ONG' ? 'DOADOR' : 'ONG' })).status, 401);
      const logged = await call('/login', body);
      assert.equal(logged.status, 200);
      const { token } = logged.body;
      assert.equal((await call('/me', undefined, token)).body.usuario.email, body.email);
      const [sessions] = await database.execute('SELECT token_hash FROM sessoes WHERE usuario_id = ?', [logged.body.usuario.id]);
      assert.notEqual(sessions[0].token_hash, token, 'Token deve ser armazenado somente como hash');
      await database.execute('UPDATE usuarios SET ativo = 0 WHERE id = ?', [logged.body.usuario.id]);
      assert.equal((await call('/me', undefined, token)).status, 401);
      assert.equal((await call('/login', body)).status, 401);
      await database.execute('UPDATE usuarios SET ativo = 1 WHERE id = ?', [logged.body.usuario.id]);
      await database.execute('UPDATE sessoes SET expira_em = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE usuario_id = ?', [logged.body.usuario.id]);
      assert.equal((await call('/me', undefined, token)).status, 401);
      assert.equal((await call('/logout', {}, token)).status, 204);
      assert.equal((await call('/me', undefined, token)).status, 401);
    }
    assert.equal((await call('/me')).status, 401);
    assert.equal((await call('/login', { tipo: 'DOADOR', email: 'admin@example.test', senha: '1234' })).status, 401);
  } finally {
    for (const email of emails) await database.execute('DELETE FROM usuarios WHERE email = ?', [email]);
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
  }
});
