import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';

test('imagens locais validam conteúdo, limite, propriedade e vínculo público/privado', {
  skip: process.env.RUN_AUTH_INTEGRATION !== '1'
}, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  const [{ app }, { database, closeDatabase }, { runMigrations }] = await Promise.all([
    import('../dist/app.js'), import('../dist/database/mysql.js'), import('../dist/database/migrations/migrator.js')
  ]);
  await runMigrations();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const suffix = randomBytes(6).toString('hex');
  const emails = [`img-ong-${suffix}@example.test`, `img-doador-${suffix}@example.test`, `img-outro-${suffix}@example.test`];
  const tokens = [];
  const register = async (tipo, email, cnpj) => {
    const body = { tipo, nome: `Imagem ${tipo}`, email, senha: 'Teste-seguro-123', confirmacaoSenha: 'Teste-seguro-123', ...(cnpj ? { cnpj } : {}) };
    const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 201);
    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(login.status, 200);
    const result = await login.json();
    tokens.push(result.token);
    return result;
  };
  const upload = (token, content, purpose, mimeType = 'image/jpeg') => fetch(`${base}/imagens`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType, 'X-Image-Purpose': purpose }, body: content
  });
  try {
    const ong = await register('ONG', emails[0], '00.000.000/E08G-12');
    const donor = await register('DOADOR', emails[1]);
    const other = await register('DOADOR', emails[2]);
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
    assert.equal((await upload(ong.token, Buffer.from('texto'), 'PERFIL_ONG')).status, 400);
    assert.equal((await upload(ong.token, validJpeg, 'PERFIL_ONG', 'text/plain')).status, 400);
    assert.equal((await upload(ong.token, Buffer.alloc(1024 * 1024 + 1, 1), 'PERFIL_ONG')).status, 413);
    assert.equal((await upload(donor.token, validJpeg, 'CAMPANHA')).status, 403);

    const uploaded = await upload(ong.token, validJpeg, 'PERFIL_ONG');
    assert.equal(uploaded.status, 201);
    const { imagem } = (await uploaded.json());
    const privateBeforeLink = await fetch(`${base}/imagens/${imagem.id}`);
    assert.equal(privateBeforeLink.status, 404, 'Imagem enviada sem vínculo não é pública');
    const [profile] = await database.execute('SELECT id FROM perfis_ong WHERE usuario_id = ?', [ong.usuario.id]);
    await database.execute("UPDATE imagens SET vinculo_tipo = 'PERFIL_ONG', vinculo_id = ? WHERE id = ?", [profile[0].id, imagem.id]);
    const publicImage = await fetch(`${base}/imagens/${imagem.id}`);
    assert.equal(publicImage.status, 200);
    assert.equal(publicImage.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), validJpeg);

    const privateImageResponse = await upload(donor.token, validJpeg, 'DOACAO_ITEM');
    assert.equal(privateImageResponse.status, 201);
    const privateImage = (await privateImageResponse.json()).imagem;
    assert.equal((await fetch(`${base}/imagens/${privateImage.id}`, { headers: { Authorization: `Bearer ${donor.token}` } })).status, 200);
    assert.equal((await fetch(`${base}/imagens/${privateImage.id}`, { headers: { Authorization: `Bearer ${other.token}` } })).status, 404);
  } finally {
    await database.execute('DELETE FROM usuarios WHERE email IN (?, ?, ?)', emails);
    await new Promise((resolve) => server.close(resolve));
    await closeDatabase();
  }
});
