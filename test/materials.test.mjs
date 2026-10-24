import test from 'node:test';
import assert from 'node:assert/strict';

test('valida necessidade, quantidade decimal e campos de intenção de material', async () => {
  const { validateNeed, validateItemDonation, validateItemStatus } = await import('../dist/materials/validation.js');
  const need = validateNeed({ categoriaId: '2', titulo: 'Água', descricao: 'Garrafas fechadas', tipo: 'Água', quantidade: '10.5', unidade: 'litros' });
  assert.equal(need.quantidade, '10.50');
  assert.equal(need.imagemId, null);
  for (const quantity of ['0', '-1', '1.001', '100000000', 'abc']) {
    assert.throws(() => validateNeed({ categoriaId: '2', titulo: 'X', descricao: 'Y', tipo: 'X', quantidade, unidade: 'un' }));
  }
  assert.throws(() => validateNeed({ categoriaId: '999', titulo: 'X', descricao: 'Y', tipo: 'X', quantidade: 1, unidade: 'un', imagemId: 'x' }));
  const donation = validateItemDonation({ necessidadeId: '1', quantidade: 4, formaEntrega: 'RETIRADA', observacao: 'Posso levar sábado', dataEntrega: '2026-10-24T12:00:00.000Z' });
  assert.equal(donation.quantidade, '4.00');
  assert.equal(donation.formaEntrega, 'RETIRADA');
  assert.throws(() => validateItemDonation({ necessidadeId: '1', quantidade: 1, formaEntrega: 'RETIRADA', dataEntrega: '2026-02-30T12:00:00.000Z' }));
  assert.throws(() => validateItemDonation({ necessidadeId: '1', quantidade: 1, formaEntrega: 'CORREIO' }));
  assert.equal(validateItemStatus({ status: 'ENTREGUE' }).status, 'ENTREGUE');
  assert.throws(() => validateItemStatus({ status: 'PENDENTE' }));
});
