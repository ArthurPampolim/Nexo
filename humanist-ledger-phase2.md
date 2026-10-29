# Plano de Implementação: Humanist Ledger - Fase 2

> **Objetivo:** Implementar o Drawer de Transações (com Bottom Sheet móvel), Aporte Mensal Inteligente nas Metas e Cards de Alertas/Insights no Dashboard, mantendo conformidade rigorosa com o `DESIGN.md`.

---

## 🎯 Escopo Acordado
1. **Transações (Slide-over / Drawer):** Painel lateral deslizante à direita no desktop (420px) e Bottom Sheet móvel (< 768px, 85vh) para detalhes e edição rápida de transações.
2. **Metas (Smart Monthly Target):** Cálculo automático de sugestão de aporte mensal (`saldo_faltante / meses_restantes`), badges de status ("No ritmo", "Atenção", "Sem prazo", "Prazo encerrado").
3. **Dashboard (Alerts & Insights):** Banner horizontal de cards contextuais de alta prioridade (vencimento de faturas, categoria com maior alta, status de metas).

---

## 📋 Tarefas de Execução

- [x] **Tarefa 1: Estrutura HTML do Drawer & Bottom Sheet de Transações**
  - Inserir container `#tx-details-drawer` com overlay, header ergonômico, formulário de edição rápida e botões de ação em `index.html`.
  - *Verificação:* Concluído com sucesso no DOM.

- [x] **Tarefa 2: Estilos CSS do Drawer / Bottom Sheet & Animações**
  - Implementar classes `.tx-drawer`, `.tx-drawer-overlay` e regra `@media (max-width: 768px)` com transformação vertical em `src/style.css`.
  - *Verificação:* Drawer desliza da direita em desktop e sobe como Bottom Sheet no mobile.

- [x] **Tarefa 3: Lógica JS para Abertura, Fechamento e Edição Rápida**
  - Adicionar funções `AppController.openTxDrawer(id)`, `AppController.closeTxDrawer()`, suporte à tecla `ESC` e clique no overlay em `src/main.js`.
  - *Verificação:* Clicar em qualquer linha da tabela abre o drawer com os dados corretos e ações de salvar/excluir.

- [x] **Tarefa 4: Algoritmo de Aporte Mensal & Badges de Status em Metas**
  - Adicionar cálculo de meses restantes e cota mensal em `renderGoals()` no `src/main.js`.
  - Adicionar tratamento para metas sem prazo ou com prazo expirado.
  - *Verificação:* Cards de metas exibem badge ("No ritmo", "Atenção", "Concluído", "Sem prazo", "Prazo encerrado") e valor "Aporte sugerido: R$ X/mês".

- [x] **Tarefa 5: Seção de Alertas & Insights no Topo do Dashboard**
  - Adicionar container `#dashboard-insights-banner` no topo do Dashboard em `index.html` e estilos em `src/style.css`.
  - Implementar gerador dinâmico de insights no `src/main.js` (alerta de fatura próxima, meta em destaque, balanço do mês).
  - *Verificação:* Dashboard renderiza 3 cards de insights dinâmicos e clicáveis com dados reais.

- [x] **Tarefa 6: Auditoria de Estilo, Tema Escuro e Build Vite**
  - Validar contraste no Dark Mode (`body.dark-mode`), responsividade mobile e executar `npx vite build`.
  - *Verificação:* Build do Vite concluído com sucesso (`dist/` gerado sem erros).

---

## 🏁 Fase de Verificação
- [x] Executar build de produção (`npx vite build`) — *Chunking otimizado e zero warnings (código 0).*
- [ ] Testar fluxo completo: Abrir transação no drawer → Fechar com ESC → Inspecionar cálculo da meta → Visualizar alertas no dashboard.
