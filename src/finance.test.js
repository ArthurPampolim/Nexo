import { describe, it, expect } from 'vitest';
import {
  isSettled, settledTotals, accountBalances, monthSummary,
  roundCents, parseCurrencyMask, isTransferTransaction, txAddMonths, parseLocalDate
} from './finance.js';

// "Hoje" fixo para os testes não dependerem do relógio
const NOW = new Date(2026, 5, 15, 10, 0, 0); // 15/06/2026

describe('isSettled', () => {
  it('sem campo Efetivado, vale a data (passado e hoje efetivam, futuro não)', () => {
    expect(isSettled({ Data: '2026-06-14' }, NOW)).toBe(true);
    expect(isSettled({ Data: '2026-06-15' }, NOW)).toBe(true);
    expect(isSettled({ Data: '2026-06-16' }, NOW)).toBe(false);
  });

  it('Efetivado explícito vence a data', () => {
    expect(isSettled({ Data: '2026-12-01', Efetivado: true }, NOW)).toBe(true);
    expect(isSettled({ Data: '2026-01-01', Efetivado: false }, NOW)).toBe(false);
  });
});

describe('accountBalances', () => {
  const accounts = [
    { Nome: 'Banco', SaldoInicial: '1000' },
    { Nome: 'Carteira', SaldoInicial: 50 }
  ];

  it('soma saldo inicial, receitas e despesas efetivadas', () => {
    const txs = [
      { Tipo: 'RECEITA', Valor: 500, Conta: 'Banco', Data: '2026-06-01' },
      { Tipo: 'DESPESA', Valor: 200.5, Conta: 'Banco', Data: '2026-06-10' },
      { Tipo: 'DESPESA', Valor: 20, Conta: 'Carteira', Data: '2026-06-15' }
    ];
    expect(accountBalances(accounts, txs, NOW)).toEqual({ Banco: 1299.5, Carteira: 30 });
  });

  it('agendadas não alteram o saldo, até serem marcadas como efetivadas', () => {
    const scheduled = { Tipo: 'DESPESA', Valor: 300, Conta: 'Banco', Data: '2026-06-10', Efetivado: false };
    expect(accountBalances(accounts, [scheduled], NOW).Banco).toBe(1000);
    expect(accountBalances(accounts, [{ ...scheduled, Efetivado: true }], NOW).Banco).toBe(700);
  });

  it('despesa futura sem o campo (legado) não desconta ainda', () => {
    const future = { Tipo: 'DESPESA', Valor: 100, Conta: 'Banco', Data: '2026-07-01' };
    expect(accountBalances(accounts, [future], NOW).Banco).toBe(1000);
  });

  it('conta desconhecida ou vazia é ignorada', () => {
    const txs = [
      { Tipo: 'RECEITA', Valor: 10, Conta: 'Inexistente', Data: '2026-06-01' },
      { Tipo: 'RECEITA', Valor: 10, Data: '2026-06-01' }
    ];
    expect(accountBalances(accounts, txs, NOW)).toEqual({ Banco: 1000, Carteira: 50 });
  });
});

describe('settledTotals', () => {
  it('conta só efetivadas', () => {
    const txs = [
      { Tipo: 'RECEITA', Valor: 100, Data: '2026-06-01' },
      { Tipo: 'DESPESA', Valor: 40, Data: '2026-06-02' },
      { Tipo: 'DESPESA', Valor: 999, Data: '2026-06-03', Efetivado: false },
      { Tipo: 'RECEITA', Valor: 999, Data: '2026-07-01' }
    ];
    expect(settledTotals(txs, NOW)).toEqual({ income: 100, expense: 40 });
  });
});

describe('monthSummary', () => {
  it('ignora transferências e transações marcadas como ignoradas', () => {
    const txs = [
      { Tipo: 'RECEITA', Valor: 1000, Categoria: 'Salário' },
      { Tipo: 'DESPESA', Valor: 250, Categoria: 'Mercado' },
      { Tipo: 'DESPESA', Valor: 500, Categoria: 'Transferência' },
      { Tipo: 'RECEITA', Valor: 500, Categoria: 'Transferencia' },
      { Tipo: 'DESPESA', Valor: 80, Categoria: 'Lazer', Ignorar: true }
    ];
    expect(monthSummary(txs)).toEqual({ income: 1000, expense: 250 });
  });
});

describe('isTransferTransaction', () => {
  it('reconhece com e sem acento, sem diferenciar maiúsculas', () => {
    expect(isTransferTransaction({ Categoria: 'Transferência' })).toBe(true);
    expect(isTransferTransaction({ Categoria: 'TRANSFERENCIA entre contas' })).toBe(true);
    expect(isTransferTransaction({ Categoria: 'Mercado' })).toBe(false);
    expect(isTransferTransaction(null)).toBe(false);
  });
});

describe('roundCents', () => {
  it('corrige erro de ponto flutuante e elimina -0', () => {
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
    expect(roundCents('abc')).toBe(0);
  });
});

describe('parseCurrencyMask', () => {
  it('lê só os dígitos como centavos', () => {
    expect(parseCurrencyMask('R$ 1.234,56')).toBe(1234.56);
    expect(parseCurrencyMask('0,05')).toBe(0.05);
    expect(parseCurrencyMask('')).toBe(0);
    expect(parseCurrencyMask(12.5)).toBe(12.5);
  });
});

describe('txAddMonths', () => {
  it('mantém o dia quando existe', () => {
    expect(txAddMonths('2026-01-15', 1)).toBe('2026-02-15');
  });

  it('usa o último dia do mês quando o dia não existe', () => {
    expect(txAddMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(txAddMonths('2028-01-31', 1)).toBe('2028-02-29'); // bissexto
  });

  it('atravessa o ano', () => {
    expect(txAddMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('parseLocalDate', () => {
  it('não troca de dia por fuso horário', () => {
    const d = parseLocalDate('2026-03-05');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 5]);
  });
});
