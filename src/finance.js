// ── Cálculos financeiros puros (sem DOM nem Firebase, testáveis) ──

const pad = (n) => String(n).padStart(2, '0');

export const txLocalISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// "2026-03-05" vira meio-dia local (evita virar o dia por fuso)
export function parseLocalDate(dateInput) {
  if (!dateInput) return new Date();
  if (dateInput instanceof Date) return dateInput;
  const parts = String(dateInput).split('T')[0].split('-');
  if (parts.length === 3) {
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
  }
  return new Date(dateInput);
}

// Arredonda para centavos e elimina o -0 gerado por erros de ponto flutuante
export function roundCents(value) {
  return Math.round((parseFloat(value) || 0) * 100) / 100 + 0;
}

// Máscara de moeda digita só dígitos: "1.234,56" -> 1234.56
export function parseCurrencyMask(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  return (parseFloat(str.replace(/\D/g, '')) / 100) || 0;
}

export function isTransferTransaction(t) {
  const cat = String(t ? t.Categoria : '').toLowerCase();
  return cat.includes('transferência') || cat.includes('transferencia');
}

// Soma meses mantendo o dia (ou o último dia do mês, se não existir)
export function txAddMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, last));
  return txLocalISO(target);
}

// Efetivado (pago/recebido) entra no saldo; agendado não. Sem o campo, vale a data (legado).
export function isSettled(t, now = new Date()) {
  if (typeof t.Efetivado === 'boolean') return t.Efetivado;
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return parseLocalDate(t.Data) <= end;
}

// Totais das transações já efetivadas
export function settledTotals(txs, now = new Date()) {
  return txs.reduce((acc, t) => {
    if (isSettled(t, now)) {
      const amount = parseFloat(t.Valor) || 0;
      if (t.Tipo === 'RECEITA') acc.income += amount;
      else if (t.Tipo === 'DESPESA') acc.expense += amount;
    }
    return acc;
  }, { income: 0, expense: 0 });
}

// Saldo por nome de conta: saldo inicial + transações efetivadas
export function accountBalances(accounts, txs, now = new Date()) {
  const balances = {};
  accounts.forEach(acc => { balances[acc.Nome] = parseFloat(acc.SaldoInicial) || 0; });
  txs.forEach(t => {
    if (!isSettled(t, now) || !t.Conta || balances[t.Conta] === undefined) return;
    const amount = parseFloat(t.Valor) || 0;
    if (t.Tipo === 'RECEITA') balances[t.Conta] += amount;
    else if (t.Tipo === 'DESPESA') balances[t.Conta] -= amount;
  });
  return balances;
}

// Receitas e despesas do mês: ignora transferências e transações marcadas como ignoradas
export function monthSummary(txs) {
  return txs.reduce((acc, t) => {
    if (isTransferTransaction(t) || t.Ignorar) return acc;
    const amount = parseFloat(t.Valor) || 0;
    if (t.Tipo === 'RECEITA') acc.income += amount;
    else if (t.Tipo === 'DESPESA') acc.expense += amount;
    return acc;
  }, { income: 0, expense: 0 });
}
