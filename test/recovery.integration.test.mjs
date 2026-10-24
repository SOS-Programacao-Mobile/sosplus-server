import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

test('recuperação local captura mensagem, revoga códigos/sessões e consome uma única vez', { skip: process.env.RUN_AUTH_INTEGRATION !== '1' }, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  process.env.RECOVERY_ENABLED = 'true';
  const [{ app }, { database, closeDatabase }, { runMigrations }, recovery] = await Promise.all([
    import('../dist/app.js'), import('../dist/database/mysql.js'), import('../dist/database/migrations/migrator.js'), import('../dist/auth/recovery.js')
  ]);
  await runMigrations();
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1/auth`;
  const mailbox = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';
  const email = `recovery-${randomBytes(6).toString('hex')}@example.test`;
  const mailIds = new Set();
  const input = { tipo: 'DOADOR', nome: 'Teste recuperação local', email, senha: 'Senha-anterior-123', confirmacaoSenha: 'Senha-anterior-123' };
  const call = async (path, body, token) => {
    const response = await fetch(`${base}${path}`, { method: path === '/me' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), cache: response.headers.get('Cache-Control') };
  };
  const latestCode = async () => {
    let message;
    for (let attempt=0;attempt<40;attempt++) {
      const list = await (await fetch(`${mailbox}/api/v1/messages?limit=100`)).json();
      message = list.messages.find((item) => item.To?.some((to) => to.Address === email) && !mailIds.has(item.ID));
      if(message) break;
      await new Promise((resolve)=>setTimeout(resolve,50));
    }
    assert.ok(message, 'mensagem deve ser capturada somente na caixa local');
    mailIds.add(message.ID);
    const full = await (await fetch(`${mailbox}/api/v1/message/${message.ID}`)).json();
    const code = full.Text.match(/\b[a-f0-9]{64}\b/)?.[0];
    assert.ok(code, 'mensagem contém código de alta entropia');
    return code;
  };
  try {
    assert.equal((await call('/register', input)).status, 201);
    const login = await call('/login', input);
    const response = await call('/recuperacao', { email });
    const missing = await call('/recuperacao', { email: `missing-${email}` });
    assert.deepEqual(response.body, missing.body);
    assert.equal(response.cache, 'no-store');
    assert.equal('codigo' in response.body, false);
    const firstCode = await latestCode();
    const [rows] = await database.execute(`SELECT codigo_hash,TIMESTAMPDIFF(SECOND,criado_em,expira_em) prazo FROM recuperacoes_senha WHERE usuario_id=(SELECT id FROM usuarios WHERE email=?) ORDER BY id DESC LIMIT 1`, [email]);
    assert.ok(rows[0].codigo_hash !== firstCode, 'banco armazena somente hash');
    assert.equal(Number(rows[0].prazo), 900);
    const reset = (code) => ({ email, codigo: code, novaSenha: 'Nova-senha-456', confirmacaoSenha: 'Nova-senha-456' });
    assert.equal((await call('/recuperacao/confirmar', reset('0'.repeat(64)))).status, 400);
    await call('/recuperacao', { email });
    const secondCode = await latestCode();
    assert.equal((await call('/recuperacao/confirmar', reset(firstCode))).status, 400);
    const parallel = await Promise.all([call('/recuperacao/confirmar', reset(secondCode)), call('/recuperacao/confirmar', reset(secondCode))]);
    assert.deepEqual(parallel.map((item) => item.status).sort(), [204, 400]);
    assert.equal((await call('/me', null, login.body.token)).status, 401);
    assert.equal((await call('/login', input)).status, 401);
    assert.equal((await call('/login', { ...input, senha: 'Nova-senha-456' })).status, 200);
    assert.equal((await call('/recuperacao/confirmar', reset(secondCode))).status, 400);
    await call('/recuperacao', { email });
    const expiredCode = await latestCode();
    await database.execute('UPDATE recuperacoes_senha SET expira_em=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE usuario_id=(SELECT id FROM usuarios WHERE email=?)', [email]);
    assert.equal((await call('/recuperacao/confirmar', reset(expiredCode))).status, 400);
    await recovery.requestPasswordRecovery({ email });
    const blockedCode = await latestCode();
    for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(recovery.confirmPasswordRecovery(reset('0'.repeat(64))));
    await assert.rejects(recovery.confirmPasswordRecovery(reset(blockedCode)));
    await call('/recuperacao', { email: `missing-${email}` });
    assert.equal((await call('/recuperacao', { email })).status, 429);
  } finally {
    await database.execute('DELETE FROM usuarios WHERE email=?', [email]);
    for (const id of mailIds) await fetch(`${mailbox}/api/v1/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [id] }) });
    await new Promise((resolve) => server.close(resolve)); await closeDatabase();
  }
});
