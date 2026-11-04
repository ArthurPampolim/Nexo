---
version: 2.0.0
name: Nexo Humanist Ledger
description: Design system financeiro que une o rigor contábil (números tabulares em JetBrains Mono, alinhamento preciso de dados) à suavidade ergonômica (raios de 8 a 16px, sombras macias, animações curtas). A identidade de cor parte da logo de pontos do Nexo: carvão azulado e verde-água.
colors:
  primary: "#36454f"
  primary-hover: "#212b31"
  secondary: "#4b5f6d"
  secondary-light: "#e3efee"
  accent: "#6fa9a8"
  accent-hover: "#5c9493"
  accent-muted: "rgba(111, 169, 168, 0.16)"
  on-accent: "#212b31"
  palette-soft: "#8fbcbb"
  palette-tint: "#afcfce"
  surface: "#ffffff"
  surface-subtle: "#f5f9f9"
  background: "#eef3f3"
  border: "#dbe5e5"
  border-strong: "#c3d3d3"
  text-primary: "#212b31"
  text-secondary: "#4b5f6d"
  text-muted: "#5b6d79"
  success: "#059669"
  danger: "#e11d48"
  warning: "#d97706"
  info: "#0284c7"
  dark-background: "#212b31"
  dark-surface: "#29353c"
  dark-surface-subtle: "#263138"
  dark-border: "#36454f"
  dark-border-strong: "#4b5f6d"
  dark-primary: "#4b5f6d"
  dark-primary-hover: "#5a7080"
  dark-text-primary: "#eef4f4"
  dark-text-secondary: "#c5d6d5"
  dark-text-muted: "#9db5b4"
typography:
  fontFamily-sans: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  fontFamily-mono: "'JetBrains Mono', 'SF Mono', Consolas, monospace"
  headline-lg:
    fontFamily: "{typography.fontFamily-sans}"
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.02em
  headline-md:
    fontFamily: "{typography.fontFamily-sans}"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.01em
  body-md:
    fontFamily: "{typography.fontFamily-sans}"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  value-display:
    fontFamily: "{typography.fontFamily-mono}"
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.2
    fontFeatureSettings: "'tnum' on, 'zero' on"
rounded:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
components:
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    border: "1px solid {colors.border}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.full}"
    fontWeight: 700
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.full}"
    fontWeight: 700
---

# Nexo — Sistema de Design: Humanist Ledger

## 1. Visão geral

O **Humanist Ledger** combina duas ideias: o **rigor de um livro-razão** (números alinhados, dados auditáveis, contraste claro) e a **suavidade de uma interface amigável** (cantos arredondados, sombras macias, movimento curto e discreto). A identidade de cor vem da logo do Nexo, uma malha de pontos em grafite, e adota a paleta de **carvão azulado** e **verde-água**.

Os tokens vivem como variáveis CSS em `:root`, no topo de `src/style.css`. O tema escuro redefine as mesmas variáveis em `body.dark-mode`, então nenhum componente precisa de uma versão separada.

## 2. Cor

### Paleta da marca

| Papel | Token | Valor |
|---|---|---|
| Primária (botões, sidebar ativa, pílulas) | `--primary-color` | `#36454f` |
| Primária (hover) | `--primary-hover` | `#212b31` |
| Secundária e texto de apoio | `--secondary-color` | `#4b5f6d` |
| Destaque | `--accent-color` | `#6fa9a8` |
| Destaque (hover) | `--accent-hover` | `#5c9493` |
| Texto sobre o destaque | `--on-accent` | `#212b31` |
| Fundo suave de destaque | `--accent-subtle` | `rgba(111, 169, 168, 0.16)` |

Tons de apoio da paleta, usados em gráficos e degradês: `#8fbcbb` (verde acinzentado claro) e `#afcfce` (verde-água claro).

### Neutros

| Papel | Claro | Escuro |
|---|---|---|
| Fundo da página | `#eef3f3` | `#212b31` |
| Cartões e superfícies | `#ffffff` | `#29353c` |
| Superfície sutil | `#f5f9f9` | `#263138` |
| Bordas | `#dbe5e5` | `#36454f` |
| Bordas fortes | `#c3d3d3` | `#4b5f6d` |
| Texto principal | `#212b31` | `#eef4f4` |
| Texto secundário | `#4b5f6d` | `#c5d6d5` |
| Texto discreto | `#5b6d79` | `#9db5b4` |

No tema escuro, a cor primária sobe para `#4b5f6d`, porque o carvão original quase some sobre as superfícies escuras.

### Cores de estado

As cores de estado ficam fora da paleta da marca, de propósito: receita e despesa precisam ser reconhecidas de imediato.

| Estado | Token | Valor |
|---|---|---|
| Sucesso e receitas | `--success-color` | `#059669` |
| Erro e despesas | `--danger-color` | `#e11d48` |
| Alerta e pendências | `--warning-color` | `#d97706` |
| Informação e transferências | `--info-color` | `#0284c7` |

### Contraste

- Texto branco sobre o verde-água (`#6fa9a8`) tem contraste de apenas 2,65:1. Por isso, **todo texto sobre o destaque usa `--on-accent`** (grafite, 5,44:1).
- Texto branco sobre o carvão (`#36454f`) tem 9,9:1. É a combinação padrão dos botões primários.
- Texto de apoio no tema escuro usa `#9db5b4` (6,9:1 sobre o grafite). O cinza-azulado `#4b5f6d` não deve ser usado como texto sobre fundo escuro.

## 3. Tipografia

- **Interface:** `Plus Jakarta Sans`.
- **Valores financeiros:** `JetBrains Mono` com números tabulares (`font-feature-settings: 'tnum' 1, 'zero' 1`), aplicada a saldos, receitas, despesas, totais e datas. Os dígitos alinham em coluna e o zero é cortado, evitando confusão com a letra O.

| Estilo | Tamanho | Peso |
|---|---|---|
| Título de tela | 24 a 28px | 700 |
| Título de seção | 18px | 600 |
| Corpo | 14px | 400 |
| Valor em destaque | 22px (mono) | 700 |

## 4. Geometria e profundidade

- **Raios:** 4px (detalhes), 8px (inputs e botões), 12px (cartões e contas), 16px (modais e painéis) e pílula completa (filtros, badges, botões de ação).
- **Sombras:** em camadas e suaves, com matiz grafite (`rgba(33, 43, 49, ...)`), em quatro níveis (`--shadow-xs` a `--shadow-lg`).
- **Foco:** anel de 3px na cor de destaque (`--shadow-focus`), sempre visível ao navegar pelo teclado.

## 5. Movimento

O movimento é curto e serve para orientar, não para decorar.

| Elemento | Comportamento |
|---|---|
| Entrada de tela | Fade com subida de 18px em 0,5s; os blocos principais entram em cascata, com 50ms de intervalo. |
| **Menus e abas** | **Pílula deslizante:** um único indicador que se estica para cobrir a origem e o destino e depois encolhe no destino (0,32s, com 240ms de espera). É o padrão de todo menu, aba ou seletor segmentado. |
| Painéis laterais | Deslizam da direita em 0,35s. No celular viram uma folha que sobe da base. |
| Modais e diálogos | Fade com leve escala. |
| Avisos (toasts) | Entram e saem pela direita. |

**Acessibilidade:** com `prefers-reduced-motion: reduce` (por exemplo, "Efeitos de animação" desligado no Windows), todas as animações e transições são reduzidas a praticamente zero.

## 6. Componentes

### Navegação
- **Sidebar fixa** com o item ativo marcado pela pílula deslizante vertical.
- **Seletores segmentados** (`.seg-control`, `.seg-pill`, `.seg-btn`) para abas de Objetivos, Perfil e Configurações.
- O cabeçalho é fixo (`sticky`), com altura de 77px (`--top-nav-height`), e a sidebar encaixa logo abaixo dele.

### Botões
- **Primário de ação** (`.btn-add-card`): pílula em degradê carvão, com sombra e o ícone "+" girando no hover. No tema escuro, usa o verde-água com texto grafite.
- **Salvar** (`.tx-btn-save`): pílula primária.
- **Perigo** (`.btn-danger-outline`): contorno vermelho que preenche no hover.

### Superfícies
- **Cartões de resumo:** borda lateral colorida e valor em fonte monoespaçada.
- **Painel lateral** (`.tx-drawer`): detalhes de transação e de cartão, com o mesmo componente para ambos.
- **Cartões de crédito visuais:** degradês da paleta (carvão e verde-água) mais dois tons quentes, para distinguir cartões diferentes, com barra de limite que muda de cor perto do teto.
- **Calendário semanal:** grade de 44px por hora, evento arrastável com encaixe de 15 minutos, linha do horário atual e itens automáticos de vencimento com borda tracejada.

### Modais e confirmações
- **Modal de lançamento:** uma coluna principal e uma coluna de detalhes que se expande ao lado. A cor de destaque acompanha o tipo (vermelho para despesa, verde para receita).
- **Seletor de data** e **diálogo de confirmação** próprios, no lugar dos recursos nativos do navegador.
- Com qualquer modal aberto, a rolagem da página de fundo fica travada.

### Formulários
- Campos com linha inferior em vez de caixa, ícone à esquerda e cor de foco que acompanha o contexto.
- Selects usam Choices.js, estilizados pelos mesmos tokens nos dois temas.

## 7. Marca

| Uso | Arquivo |
|---|---|
| Logo para fundo claro | `src/assets/nexo-logo-pontos-claro.svg` |
| Logo para fundo escuro | `src/assets/nexo-logo-pontos-escuro.svg` |
| Ícone da aba do navegador | `src/assets/nexo-aba-simbolo.svg` (inverte para claro quando o navegador está em tema escuro) |

A logo troca sozinha conforme o tema, usando as classes `.brand-logo-light` e `.brand-logo-dark`.

## 8. Princípios

1. **Um token por decisão.** Cor, raio e sombra vêm sempre de variáveis, nunca de valores soltos.
2. **Números primeiro.** Dados financeiros em fonte monoespaçada e alinhados à direita.
3. **Contraste verificado.** Todo texto sobre a cor de destaque usa `--on-accent`.
4. **Movimento com propósito.** Toda animação mostra de onde algo veio ou para onde foi, e respeita a preferência do sistema.
5. **Mesmo padrão em todo lugar.** Um menu novo usa a pílula; uma exclusão nova usa o diálogo de confirmação.
