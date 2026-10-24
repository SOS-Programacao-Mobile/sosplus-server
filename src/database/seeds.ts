import type { PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { database } from './mysql.js';
import { hashPassword } from '../auth/password.js';

export const demoEmails = ['demo.ong@sosplus.example.test', 'demo.ong2@sosplus.example.test', 'demo.doador@sosplus.example.test'];
export const referenceCategories = ['Apoio social', 'Alimentação', 'Educação', 'Saúde', 'Meio ambiente', 'Proteção animal'];

export async function seedReference(connection: PoolConnection | typeof database = database) {
  for (const name of referenceCategories) await connection.execute('INSERT IGNORE INTO categorias (nome) VALUES (?)', [name]);
}

export async function seedDemo() {
  if (process.env.NODE_ENV === 'production') throw new Error('Dados de demonstração não podem ser carregados em produção.');
  const connection = await database.getConnection();
  const password = await hashPassword('SosPlus-Demo-123!');
  let created = 0;
  try {
    await connection.beginTransaction();
    await seedReference(connection);
    const [categories] = await connection.execute<(RowDataPacket & { id: string })[]>("SELECT CAST(id AS CHAR) id FROM categorias WHERE nome='Alimentação'");
    for (let index = 0; index < 2; index++) {
      const cnpj = demoCnpj(index);
      const [existing] = await connection.execute<RowDataPacket[]>(`SELECT id FROM usuarios WHERE email=? UNION ALL SELECT usuario_id FROM perfis_ong WHERE cnpj=?`, [demoEmails[index],cnpj]);
      if (existing.length) continue;
      const [user] = await connection.execute<ResultSetHeader>("INSERT INTO usuarios (email,senha_hash,tipo) VALUES (?,?,'ONG')", [demoEmails[index],password]);
      const [profile] = await connection.execute<ResultSetHeader>('INSERT INTO perfis_ong (usuario_id,nome,cnpj,descricao) VALUES (?,?,?,?)', [user.insertId,`[DEMO] SOSPlus Comunidade ${index+1}`,cnpj,'Organização fictícia para demonstração acadêmica.']);
      await connection.execute('INSERT INTO ong_categorias (ong_id,categoria_id) VALUES (?,?)', [profile.insertId,categories[0].id]);
      await connection.execute(`INSERT INTO enderecos_ong (ong_id,cep,logradouro,numero,bairro,cidade,estado,latitude,longitude) VALUES (?,'28610-000','Rua de demonstração',?,'Centro','Nova Friburgo','RJ',?,?)`, [profile.insertId,String(index+1),-22.282+index*.002,-42.531+index*.002]);
      const [campaign] = await connection.execute<ResultSetHeader>(`INSERT INTO campanhas (ong_id,categoria_id,titulo,descricao,meta_valor,data_inicio,data_fim,status) VALUES (?,?,?,?,'1000.00',CURDATE(),DATE_ADD(CURDATE(),INTERVAL 30 DAY),'ATIVA')`, [profile.insertId,categories[0].id,`[DEMO] Alimentos para a comunidade ${index+1}`,'Campanha fictícia. Contribuições usam apenas saldo simulado.']);
      await connection.execute(`INSERT INTO necessidades (ong_id,categoria_id,titulo,descricao,tipo,quantidade,unidade) VALUES (?,?,?,'Itens fictícios para exercitar recebimentos.','Alimentos','10.00','unidades')`, [profile.insertId,categories[0].id,`[DEMO] Dez cestas ${index+1}`]);
      await connection.execute('INSERT INTO publicacoes (ong_id,campanha_id,texto) VALUES (?,?,?)', [profile.insertId,campaign.insertId,'[DEMO] Nossa campanha de demonstração está ativa.']);
      created++;
    }
    const [donors] = await connection.execute<RowDataPacket[]>('SELECT id FROM usuarios WHERE email=?', [demoEmails[2]]);
    if (!donors.length) {
      const [user] = await connection.execute<ResultSetHeader>("INSERT INTO usuarios (email,senha_hash,tipo) VALUES (?,?,'DOADOR')", [demoEmails[2],password]);
      const [profile] = await connection.execute<ResultSetHeader>("INSERT INTO perfis_doador (usuario_id,nome) VALUES (?,'[DEMO] Doador SOSPlus')", [user.insertId]);
      await connection.execute('INSERT INTO carteiras_simuladas (doador_id,saldo_centavos) VALUES (?,10000)', [profile.insertId]);
      created++;
    }
    await connection.commit();
    return { contasCriadas: created };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

function demoCnpj(index: number) {
  const base = `9900000${index+1}0000`;
  const digit = (value: string) => { const remainder = [...value].reverse().reduce((sum,char,i)=>sum+Number(char)*(i%8+2),0)%11; return String(remainder<2?0:11-remainder); };
  const first=base+digit(base); return first+digit(first);
}
