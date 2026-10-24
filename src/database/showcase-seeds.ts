import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { hashPassword } from '../auth/password.js';
import { encryptPersonalData } from '../security/personal-data.js';
import { database } from './mysql.js';
import { referenceCategories, seedReference } from './seeds.js';

const demoPassword = 'SosPlus-Demo-123!';
const orgNames = [
  'Patinhas do Bem', 'Instituto Acolher', 'Casa Recomeço', 'Rede Mãos Unidas',
  'Projeto Sementes', 'Amigos da Serra', 'Instituto Vida Plena', 'Lar Esperança',
  'Coletivo Verde Vivo', 'Cozinha Solidária', 'Educa Comunidade', 'Saúde para Todos',
  'Proteção Animal RJ', 'Associação Novo Caminho',
];
const donorFirstNames = ['Ana', 'Bruno', 'Camila', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Hugo', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Pedro', 'Rafaela', 'Samuel', 'Talita', 'Vitor', 'Yasmin', 'André', 'Bianca', 'Caio', 'Débora', 'Enzo', 'Fernanda', 'Gustavo', 'Helena', 'Igor'];
const donorLastNames = ['Almeida', 'Barbosa', 'Carvalho', 'Dias', 'Esteves', 'Ferreira', 'Gomes', 'Lima', 'Mendes', 'Nogueira', 'Oliveira', 'Pereira', 'Queiroz', 'Ramos', 'Silva', 'Teixeira', 'Vieira', 'Xavier', 'Souza', 'Costa', 'Martins', 'Rocha', 'Freitas', 'Azevedo', 'Moreira', 'Batista', 'Cunha', 'Lopes', 'Monteiro', 'Reis'];
const cities = [
  { city: 'Nova Friburgo', state: 'RJ', cep: '28610-000', neighborhood: 'Centro', lat: -22.282, lng: -42.531 },
  { city: 'Rio de Janeiro', state: 'RJ', cep: '20010-000', neighborhood: 'Centro', lat: -22.906, lng: -43.172 },
  { city: 'Niterói', state: 'RJ', cep: '24020-000', neighborhood: 'Icaraí', lat: -22.903, lng: -43.105 },
  { city: 'Petrópolis', state: 'RJ', cep: '25620-000', neighborhood: 'Centro', lat: -22.505, lng: -43.178 },
  { city: 'São Paulo', state: 'SP', cep: '01000-000', neighborhood: 'Sé', lat: -23.550, lng: -46.633 },
  { city: 'Curitiba', state: 'PR', cep: '80010-000', neighborhood: 'Centro', lat: -25.429, lng: -49.271 },
  { city: 'Belo Horizonte', state: 'MG', cep: '30110-000', neighborhood: 'Centro', lat: -19.922, lng: -43.945 },
  { city: 'Salvador', state: 'BA', cep: '40020-000', neighborhood: 'Comércio', lat: -12.971, lng: -38.501 },
  { city: 'Recife', state: 'PE', cep: '50010-000', neighborhood: 'Santo Antônio', lat: -8.054, lng: -34.881 },
  { city: 'Porto Alegre', state: 'RS', cep: '90010-000', neighborhood: 'Centro Histórico', lat: -30.034, lng: -51.230 },
  { city: 'Florianópolis', state: 'SC', cep: '88010-000', neighborhood: 'Centro', lat: -27.595, lng: -48.548 },
  { city: 'Campinas', state: 'SP', cep: '13010-000', neighborhood: 'Centro', lat: -22.906, lng: -47.061 },
  { city: 'Brasília', state: 'DF', cep: '70040-000', neighborhood: 'Asa Sul', lat: -15.793, lng: -47.882 },
  { city: 'Goiânia', state: 'GO', cep: '74010-000', neighborhood: 'Setor Central', lat: -16.680, lng: -49.256 },
  { city: 'Manaus', state: 'AM', cep: '69005-000', neighborhood: 'Centro', lat: -3.119, lng: -60.022 },
];
const campaignIdeas = [
  ['Reforço alimentar para famílias', 'Cestas básicas, alimentos frescos e apoio emergencial para famílias atendidas.'],
  ['Um inverno mais acolhedor', 'Agasalhos, cobertores e itens de cuidado para pessoas em situação vulnerável.'],
  ['Aprender abre caminhos', 'Materiais escolares, oficinas e acompanhamento para crianças e jovens.'],
  ['Cuidado que chega a todos', 'Atendimento comunitário, itens de higiene e apoio para prevenção em saúde.'],
  ['Um futuro mais verde', 'Plantio, recuperação de áreas e educação ambiental na comunidade.'],
  ['Abrigo seguro para animais', 'Ração, vacinação e atendimento veterinário para cães e gatos resgatados.'],
];
const needIdeas = [
  ['Cestas de alimentos', 'Alimentos não perecíveis para as famílias acompanhadas.', 'Alimentos', 'unidades'],
  ['Cobertores e agasalhos', 'Itens limpos e em bom estado para os dias frios.', 'Vestuário', 'unidades'],
  ['Kits escolares', 'Cadernos, lápis e materiais para as oficinas educativas.', 'Educação', 'kits'],
  ['Kits de higiene', 'Itens de higiene pessoal para distribuição comunitária.', 'Higiene', 'kits'],
  ['Mudas para plantio', 'Mudas adequadas ao clima local para ações coletivas.', 'Meio ambiente', 'unidades'],
  ['Ração para cães e gatos', 'Ração fechada para os animais acolhidos pela ONG.', 'Proteção animal', 'kg'],
];

type Org = { id: string; name: string; email: string; categories: string[]; cityIndex: number };
type Donor = { id: string; userId: string; email: string; name: string; index: number };
type Campaign = { id: string; orgId: string; title: string; status: string; index: number };
type Need = { id: string; orgId: string; title: string; index: number };

export async function seedShowcase(): Promise<Record<string, number>> {
  if (process.env.NODE_ENV === 'production') throw new Error('Dados de demonstração não podem ser carregados em produção.');
  const requestedPassword = process.env.SHOWCASE_ONG_PASSWORD;
  if (!requestedPassword || requestedPassword.length < 8) throw new Error('Defina SHOWCASE_ONG_PASSWORD para preparar o acesso da ONG solicitada.');

  const connection = await database.getConnection();
  const requestedHash = await hashPassword(requestedPassword);
  const demoHash = await hashPassword(demoPassword);
  const orgs: Org[] = [];
  const donors: Donor[] = [];
  const campaigns: Campaign[] = [];
  const needs: Need[] = [];
  let createdUsers = 0;
  let createdCampaigns = 0;
  let createdNeeds = 0;
  let createdDonations = 0;
  let createdItemDonations = 0;
  let createdPosts = 0;

  try {
    await connection.beginTransaction();
    await seedReference(connection);
    const [categoryRows] = await connection.execute<(RowDataPacket & { id: string; nome: string })[]>(
      'SELECT CAST(id AS CHAR) id,nome FROM categorias WHERE nome IN (' + referenceCategories.map(() => '?').join(',') + ')', referenceCategories
    );
    const categoryId = new Map(categoryRows.map((row) => [row.nome, row.id]));

    const [dogUsers] = await connection.execute<(RowDataPacket & { id: string; tipo: string })[]>(
      'SELECT CAST(id AS CHAR) id,tipo FROM usuarios WHERE email=? FOR UPDATE', ['dogsjoao@gmail.com']
    );
    let dogUserId: string;
    if (dogUsers[0]) {
      if (dogUsers[0].tipo !== 'ONG') throw new Error('dogsjoao@gmail.com já está cadastrado com perfil diferente de ONG.');
      dogUserId = dogUsers[0].id;
      await connection.execute('UPDATE usuarios SET senha_hash=?,ativo=1 WHERE id=?', [requestedHash, dogUserId]);
    } else {
      const [user] = await connection.execute<ResultSetHeader>(
        "INSERT INTO usuarios (email,senha_hash,tipo) VALUES (? ,?,'ONG')", ['dogsjoao@gmail.com', requestedHash]
      );
      dogUserId = String(user.insertId);
      createdUsers++;
    }
    const [dogProfiles] = await connection.execute<(RowDataPacket & { id: string; nome: string })[]>(
      'SELECT CAST(id AS CHAR) id,nome FROM perfis_ong WHERE usuario_id=? FOR UPDATE', [dogUserId]
    );
    let dogProfileId = dogProfiles[0]?.id;
    if (!dogProfileId) {
      const [profile] = await connection.execute<ResultSetHeader>(
        'INSERT INTO perfis_ong (usuario_id,nome,cnpj) VALUES (?,?,?)', [dogUserId, 'Dogs do João', cnpjFor(90)]
      );
      dogProfileId = String(profile.insertId);
    }
    const dogName = dogProfiles[0]?.nome ?? 'Dogs do João';
    await connection.execute(`UPDATE perfis_ong SET descricao=COALESCE(descricao,?),ano_fundacao=COALESCE(ano_fundacao,2018),
      telefone=COALESCE(telefone,'(22) 99999-0090'),site=COALESCE(site,'https://sosplus.example.test/dogsjoao'),
      instagram=COALESCE(instagram,'@dogsjoao') WHERE id=?`,
    ['Organização de proteção animal. Esta conta e os registros associados formam uma massa fictícia para demonstração do SOSPlus.', dogProfileId]);
    const dogCity = cities[0];
    await connection.execute(`INSERT INTO enderecos_ong (ong_id,cep,logradouro,numero,bairro,cidade,estado,latitude,longitude)
      SELECT ?,?,?,? ,?,?,?, ?,? WHERE NOT EXISTS (SELECT 1 FROM enderecos_ong WHERE ong_id=?)`,
    [dogProfileId, dogCity.cep, 'Rua das Patinhas', '90', dogCity.neighborhood, dogCity.city, dogCity.state, dogCity.lat, dogCity.lng, dogProfileId]);
    await attachCategories(connection, dogProfileId, ['Proteção animal', 'Saúde'], categoryId);
    orgs.push({ id: dogProfileId, name: dogName, email: 'dogsjoao@gmail.com', categories: ['Proteção animal', 'Saúde'], cityIndex: 0 });

    for (let index = 0; index < orgNames.length; index++) {
      const email = `massa.ong.${String(index + 1).padStart(2, '0')}@sosplus.example.test`;
      const [existing] = await connection.execute<(RowDataPacket & { id: string; tipo: string })[]>(
        'SELECT CAST(id AS CHAR) id,tipo FROM usuarios WHERE email=? FOR UPDATE', [email]
      );
      let userId: string;
      if (existing[0]) {
        if (existing[0].tipo !== 'ONG') throw new Error(`A conta reservada ${email} já pertence a outro perfil.`);
        userId = existing[0].id;
      } else {
        const [user] = await connection.execute<ResultSetHeader>(
          "INSERT INTO usuarios (email,senha_hash,tipo) VALUES (?,?,'ONG')", [email, demoHash]
        );
        userId = String(user.insertId);
        createdUsers++;
      }
      const [profiles] = await connection.execute<(RowDataPacket & { id: string })[]>(
        'SELECT CAST(id AS CHAR) id FROM perfis_ong WHERE usuario_id=? FOR UPDATE', [userId]
      );
      let orgId = profiles[0]?.id;
      const name = orgNames[index];
      if (!orgId) {
        const [profile] = await connection.execute<ResultSetHeader>(
          'INSERT INTO perfis_ong (usuario_id,nome,cnpj,descricao,ano_fundacao,telefone,site,instagram) VALUES (?,?,?,?,?,?,?,?)',
          [userId, name, cnpjFor(index + 1), `${name} é uma organização fictícia de demonstração do SOSPlus, com campanhas e necessidades simuladas.`, 2005 + index, `(21) 9${String(8000 + index).padStart(4, '0')}-${String(1000 + index).padStart(4, '0')}`, `https://sosplus.example.test/ong/${index + 1}`, `@${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}`]
        );
        orgId = String(profile.insertId);
      }
      const city = cities[(index + 1) % cities.length];
      await connection.execute(`INSERT INTO enderecos_ong (ong_id,cep,logradouro,numero,bairro,cidade,estado,latitude,longitude)
        SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM enderecos_ong WHERE ong_id=?)`,
      [orgId, city.cep, 'Avenida da Comunidade', String(100 + index), city.neighborhood, city.city, city.state,
        city.lat + ((index % 4) * 0.001), city.lng + ((index % 4) * 0.001), orgId]);
      const selectedCategories = [referenceCategories[index % referenceCategories.length], referenceCategories[(index + 2) % referenceCategories.length]];
      await attachCategories(connection, orgId, selectedCategories, categoryId);
      orgs.push({ id: orgId, name, email, categories: selectedCategories, cityIndex: (index + 1) % cities.length });
    }

    for (let index = 0; index < donorFirstNames.length; index++) {
      const email = `massa.doador.${String(index + 1).padStart(2, '0')}@sosplus.example.test`;
      const name = `${donorFirstNames[index]} ${donorLastNames[(index * 7) % donorLastNames.length]}`;
      const [existing] = await connection.execute<(RowDataPacket & { id: string; tipo: string })[]>(
        'SELECT CAST(id AS CHAR) id,tipo FROM usuarios WHERE email=? FOR UPDATE', [email]
      );
      let userId: string;
      if (existing[0]) {
        if (existing[0].tipo !== 'DOADOR') throw new Error(`A conta reservada ${email} já pertence a outro perfil.`);
        userId = existing[0].id;
      } else {
        const [user] = await connection.execute<ResultSetHeader>(
          "INSERT INTO usuarios (email,senha_hash,tipo) VALUES (?,?,'DOADOR')", [email, demoHash]
        );
        userId = String(user.insertId);
        createdUsers++;
      }
      const [profiles] = await connection.execute<(RowDataPacket & { id: string })[]>(
        'SELECT CAST(id AS CHAR) id FROM perfis_doador WHERE usuario_id=? FOR UPDATE', [userId]
      );
      let donorId = profiles[0]?.id;
      if (!donorId) {
        const [profile] = await connection.execute<ResultSetHeader>(
          'INSERT INTO perfis_doador (usuario_id,nome) VALUES (?,?)', [userId, name]
        );
        donorId = String(profile.insertId);
      }
      const city = cities[index % cities.length];
      await connection.execute(`INSERT INTO localizacoes_usuario (usuario_id,cidade,estado,latitude,longitude) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE cidade=VALUES(cidade),estado=VALUES(estado),latitude=VALUES(latitude),longitude=VALUES(longitude)`,
      [userId, city.city, city.state, city.lat + (index % 8) * 0.001, city.lng + (index % 8) * 0.001]);
      const initialBalance = 150000 + (index % 8) * 25000;
      await connection.execute('INSERT IGNORE INTO carteiras_simuladas (doador_id,saldo_centavos) VALUES (?,?)', [donorId, initialBalance]);
      const [personal] = await connection.execute<RowDataPacket[]>('SELECT usuario_id FROM dados_pessoais_usuario WHERE usuario_id=?', [userId]);
      if (!personal.length) {
        const [firstName, ...lastNameParts] = name.split(' ');
        const values = {
          nome: encryptPersonalData(userId, 'nome', firstName)!,
          sobrenome: encryptPersonalData(userId, 'sobrenome', lastNameParts.join(' '))!,
          dataNascimento: encryptPersonalData(userId, 'dataNascimento', `${1988 + index % 20}-${String(index % 12 + 1).padStart(2, '0')}-${String(index % 27 + 1).padStart(2, '0')}`)!,
          endereco: encryptPersonalData(userId, 'endereco', `${city.city}, ${city.state}`)!,
          tipoSanguineo: encryptPersonalData(userId, 'tipoSanguineo', ['A+', 'A-', 'B+', 'O+', 'O-', 'AB+'][index % 6])!,
          genero: encryptPersonalData(userId, 'genero', index % 2 ? 'Feminino' : 'Masculino')!,
          telefone: encryptPersonalData(userId, 'telefone', `(21) 9${String(7000 + index).padStart(4, '0')}-${String(1000 + index).padStart(4, '0')}`)!,
        };
        await connection.execute(`INSERT INTO dados_pessoais_usuario
          (usuario_id,nome_cifrado,sobrenome_cifrado,data_nascimento_cifrada,endereco_cifrado,tipo_sanguineo_cifrado,genero_cifrado,telefone_cifrado)
          VALUES (?,?,?,?,?,?,?,?)`, [userId, values.nome, values.sobrenome, values.dataNascimento, values.endereco, values.tipoSanguineo, values.genero, values.telefone]);
      }
      donors.push({ id: donorId, userId, email, name, index });
    }

    const today = new Date();
    const dateString = (offset: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)).toISOString().slice(0, 10);
    for (let orgIndex = 0; orgIndex < orgs.length; orgIndex++) {
      const org = orgs[orgIndex];
      for (let itemIndex = 0; itemIndex < 5; itemIndex++) {
        const ideaIndex = (orgIndex + itemIndex) % campaignIdeas.length;
        const [titlePart, description] = campaignIdeas[ideaIndex];
        const title = `[MASSA] ${titlePart} — ${org.name} ${itemIndex + 1}`;
        const [found] = await connection.execute<(RowDataPacket & { id: string; status: string })[]>(
          'SELECT CAST(id AS CHAR) id,status FROM campanhas WHERE ong_id=? AND titulo=? LIMIT 1', [org.id, title]
        );
        let campaignId = found[0]?.id;
        const status = ['ATIVA', 'ATIVA', 'ENCERRADA', 'RASCUNHO', 'CANCELADA'][itemIndex];
        if (!campaignId) {
          const start = itemIndex === 2 || itemIndex === 4 ? dateString(-100 - orgIndex) : itemIndex === 3 ? dateString(5) : dateString(-14 - orgIndex);
          const end = itemIndex === 2 ? dateString(-2) : itemIndex === 4 ? dateString(-12) : itemIndex === 3 ? dateString(65) : dateString(35 + orgIndex % 45);
          const [campaign] = await connection.execute<ResultSetHeader>(`INSERT INTO campanhas
            (ong_id,categoria_id,titulo,descricao,meta_valor,data_inicio,data_fim,status) VALUES (?,?,?,?,?,?,?,?)`,
          [org.id, requiredCategoryId(categoryId, referenceCategories[ideaIndex]), title,
            `${description} A campanha faz parte de um conjunto fictício criado para apresentação e testes do SOSPlus.`,
            2500 + ((orgIndex + itemIndex) % 10) * 1750, start, end, status]);
          campaignId = String(campaign.insertId);
          createdCampaigns++;
        }
        campaigns.push({ id: campaignId, orgId: org.id, title, status: found[0]?.status ?? status, index: orgIndex * 5 + itemIndex });
        const postText = `[MASSA] ${org.name}: ${description} Acompanhe as atualizações da nossa comunidade.`;
        const [post] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM publicacoes WHERE ong_id=? AND texto=? LIMIT 1', [org.id, postText]
        );
        if (!post.length) {
          await connection.execute('INSERT INTO publicacoes (ong_id,campanha_id,texto) VALUES (?,?,?)', [org.id, campaignId, postText]);
          createdPosts++;
        }
      }
      for (let needIndex = 0; needIndex < 3; needIndex++) {
        const ideaIndex = (orgIndex + needIndex) % needIdeas.length;
        const [titlePart, description, type, unit] = needIdeas[ideaIndex];
        const title = `[MASSA] ${titlePart} — ${org.name} ${needIndex + 1}`;
        const [found] = await connection.execute<(RowDataPacket & { id: string; status: string })[]>(
          'SELECT CAST(id AS CHAR) id,status FROM necessidades WHERE ong_id=? AND titulo=? LIMIT 1', [org.id, title]
        );
        let needId = found[0]?.id;
        const status = needIndex === 2 ? 'ATENDIDA' : 'ATIVA';
        if (!needId) {
          const [need] = await connection.execute<ResultSetHeader>(`INSERT INTO necessidades
            (ong_id,categoria_id,titulo,descricao,tipo,quantidade,unidade,status) VALUES (?,?,?,?,?,?,?,?)`,
          [org.id, requiredCategoryId(categoryId, referenceCategories[ideaIndex]), title, `${description} Registro fictício para demonstração.`, type,
            20 + (orgIndex % 8) * 5, unit, status]);
          needId = String(need.insertId);
          createdNeeds++;
        }
        if (needIndex < 2) needs.push({ id: needId, orgId: org.id, title, index: orgIndex * 2 + needIndex });
      }
    }

    for (const donor of donors) {
      for (let sequence = 0; sequence < 4; sequence++) {
        const orgIndex = (donor.index * 3 + sequence * 4) % orgs.length;
        const org = orgs[orgIndex];
        await connection.execute('INSERT IGNORE INTO seguidores_ong (doador_id,ong_id) VALUES (?,?)', [donor.id, org.id]);
      }
      for (let sequence = 0; sequence < 4; sequence++) {
        const campaign = campaigns[(donor.index * 2 + sequence * 7) % campaigns.length];
        const operationKey = `showcase-${String(donor.index + 1).padStart(2, '0')}-${sequence + 1}`;
        const [found] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM doacoes WHERE doador_id=? AND chave_operacao=? LIMIT 1', [donor.id, operationKey]
        );
        if (!found.length) {
          const cents = 1500 + ((donor.index + sequence) % 18) * 500;
          const status = sequence < 2 ? 'CONFIRMADA' : sequence === 2 ? 'PENDENTE' : 'CANCELADA';
          const daysAgo = 2 + ((donor.index * 11 + sequence * 13) % 180);
          await connection.execute(`INSERT INTO doacoes
            (doador_id,campanha_id,valor,anonima,status,data_doacao,chave_operacao) VALUES (?,?,?,?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY),?)`,
          [donor.id, campaign.id, (cents / 100).toFixed(2), (donor.index + sequence) % 7 === 0, status, daysAgo, operationKey]);
          createdDonations++;
          if (status === 'CONFIRMADA') {
            const [debit] = await connection.execute<ResultSetHeader>(
              'UPDATE carteiras_simuladas SET saldo_centavos=saldo_centavos-? WHERE doador_id=? AND saldo_centavos>=?',
              [cents, donor.id, cents]
            );
            if (debit.affectedRows !== 1) throw new Error('Saldo fictício insuficiente ao carregar doações de demonstração.');
          }
        }
      }
      for (let sequence = 0; sequence < 3; sequence++) {
        const need = needs[(donor.index * 2 + sequence * 5) % needs.length];
        const note = `[MASSA] doação simulada ${donor.index + 1}-${sequence + 1}`;
        const [found] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM doacoes_itens WHERE doador_id=? AND necessidade_id=? AND observacao=? LIMIT 1', [donor.id, need.id, note]
        );
        if (!found.length) {
          const status = ['ENTREGUE', 'ACEITA', 'PENDENTE', 'CANCELADA'][(donor.index + sequence) % 4];
          await connection.execute(`INSERT INTO doacoes_itens
            (doador_id,necessidade_id,quantidade,observacao,forma_entrega,data_entrega,status,criado_em)
            VALUES (?,?,?,? ,?,IF(?='ENTREGUE',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 3 DAY),NULL),?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ? DAY))`,
          [donor.id, need.id, 1 + (donor.index % 4), note, sequence % 2 ? 'RETIRADA' : 'ENTREGA_NA_ONG', status,
            status, 1 + ((donor.index * 7 + sequence) % 90)]);
          createdItemDonations++;
        }
      }
    }

    await connection.commit();
    return { contasNovas: createdUsers, ongsNaCarga: orgs.length, doadoresNaCarga: donors.length,
      campanhasNovas: createdCampaigns, necessidadesNovas: createdNeeds, doacoesFinanceirasNovas: createdDonations,
      doacoesDeItensNovas: createdItemDonations, publicacoesNovas: createdPosts };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function attachCategories(connection: typeof database | Awaited<ReturnType<typeof database.getConnection>>, orgId: string,
  names: string[], ids: Map<string, string>) {
  for (const name of names) await connection.execute('INSERT IGNORE INTO ong_categorias (ong_id,categoria_id) VALUES (?,?)', [orgId, requiredCategoryId(ids, name)]);
}

function requiredCategoryId(ids: Map<string, string>, name: string): string {
  const id = ids.get(name);
  if (!id) throw new Error(`Categoria de demonstração ausente: ${name}`);
  return id;
}

function cnpjFor(index: number): string {
  const base = `88770000${String(index).padStart(4, '0')}`;
  const digit = (value: string) => {
    const remainder = [...value].reverse().reduce((sum, char, i) => sum + (char.charCodeAt(0) - 48) * (i % 8 + 2), 0) % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };
  const first = base + digit(base);
  return first + digit(first);
}
