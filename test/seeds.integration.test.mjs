import test from 'node:test';
import assert from 'node:assert/strict';

test('dados opcionais são repetíveis e preservam contas já existentes', { skip: process.env.RUN_AUTH_INTEGRATION !== '1' }, async () => {
  assert.match(process.env.MYSQL_DATABASE ?? '', /_test$/);
  const [{ database, closeDatabase }, { runMigrations }, { seedReference, seedDemo, demoEmails, referenceCategories }] = await Promise.all([
    import('../dist/database/mysql.js'), import('../dist/database/migrations/migrator.js'), import('../dist/database/seeds.js')
  ]);
  await runMigrations();
  const [preexisting] = await database.execute('SELECT id FROM usuarios WHERE email IN (?,?,?)', demoEmails);
  assert.equal(preexisting.length, 0, 'teste requer e-mails reservados de demonstração disponíveis');
  try {
    const [user] = await database.execute("INSERT INTO usuarios (email,senha_hash,tipo) VALUES (?,'hash-preservado','DOADOR')", [demoEmails[2]]);
    const [donor] = await database.execute("INSERT INTO perfis_doador (usuario_id,nome) VALUES (?,'Conta anterior preservada')", [user.insertId]);
    await database.execute('INSERT INTO carteiras_simuladas (doador_id,saldo_centavos) VALUES (?,777)', [donor.insertId]);
    await seedReference(); await seedReference();
    const [counts] = await database.query(`SELECT nome,COUNT(*) total FROM categorias WHERE nome IN (${referenceCategories.map(()=>'?').join(',')}) GROUP BY nome`, referenceCategories);
    assert.equal(counts.length,referenceCategories.length);assert.ok(counts.every(item=>Number(item.total)===1));
    assert.equal((await seedDemo()).contasCriadas,2);
    const snapshot = async () => {
      const [rows] = await database.execute(`SELECT u.email,u.senha_hash,p.nome,c.saldo_centavos FROM usuarios u
        LEFT JOIN perfis_doador p ON p.usuario_id=u.id LEFT JOIN carteiras_simuladas c ON c.doador_id=p.id WHERE email IN (?,?,?) ORDER BY email`, demoEmails);
      const [content] = await database.execute(`SELECT (SELECT COUNT(*) FROM campanhas WHERE titulo LIKE '[DEMO]%') campanhas,
        (SELECT COUNT(*) FROM necessidades WHERE titulo LIKE '[DEMO]%') necessidades,
        (SELECT COUNT(*) FROM publicacoes WHERE texto LIKE '[DEMO]%') publicacoes`);
      return { rows, content };
    };
    const first = await snapshot(); assert.equal((await seedDemo()).contasCriadas,0);assert.deepEqual(await snapshot(),first);
    const original=first.rows.find(item=>item.email===demoEmails[2]);assert.equal(original.nome,'Conta anterior preservada');assert.equal(Number(original.saldo_centavos),777);
    const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
    try { await assert.rejects(seedDemo(),/produção/); } finally { if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous; }
  } finally { await database.execute('DELETE FROM usuarios WHERE email IN (?,?,?)',demoEmails);await closeDatabase(); }
});
