---
version: 1.0.0
name: Nexo Precise Ledger
description: Design system financeiro de alta precisão com geometria técnica reta (2-4px), tipografia em Plus Jakarta Sans com algarismos tabulares em JetBrains Mono, paleta de alto contraste baseada no navy oficial (#0d253f) e sinal esmeralda (#00c985).
colors:
  primary: "#0d253f"
  primary-hover: "#08192b"
  primary-light: "#174665"
  accent: "#00c985"
  accent-hover: "#00b376"
  accent-muted: "rgba(0, 201, 133, 0.12)"
  surface: "#ffffff"
  surface-subtle: "#f8fafc"
  background: "#f1f5f9"
  border: "#e2e8f0"
  border-subtle: "#cbd5e1"
  border-focus: "#00c985"
  text-primary: "#0f172a"
  text-secondary: "#475569"
  text-muted: "#64748b"
  success: "#059669"
  danger: "#e11d48"
  warning: "#d97706"
  info: "#0284c7"
  dark-background: "#090d16"
  dark-surface: "#0f172a"
  dark-surface-subtle: "#162032"
  dark-border: "#1e293b"
  dark-text-primary: "#f8fafc"
  dark-text-secondary: "#94a3b8"
typography:
  fontFamily-sans: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  fontFamily-mono: "'JetBrains Mono', 'SF Mono', Consolas, monospace"
  headline-lg:
    fontFamily: "{typography.fontFamily-sans}"
    fontSize: 26px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.025em
  headline-md:
    fontFamily: "{typography.fontFamily-sans}"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.015em
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
  none: 0px
  xs: 2px
  sm: 3px
  md: 4px
  lg: 6px
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
    rounded: "{rounded.sm}"
    border: "1px solid {colors.border}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.xs}"
    fontWeight: 600
  button-action:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.xs}"
    fontWeight: 700
---

# Nexo — Sistema de Design: Precise Ledger

## 1. Visão Geral
O **Nexo Precise Ledger** substitui as interfaces genéricas e arredondadas ("SaaS de template") por uma linguagem visual técnica, nítida e refinada. Inspirado em consoles financeiros institucionais e interfaces contábeis modernas, valoriza a densidade da informação, clareza numérica e feedback instantâneo.

## 2. Paleta de Cores
- **Navy Profundo (`#0d253f`)**: Base de navegação, cabeçalhos e autoridade institucional.
- **Azul Petróleo (`#174665`)**: Elementos secundários, bordas ativas e estados intermediários.
- **Verde Esmeralda (`#00c985`)**: Sinais de ação prioritária, valores positivos, indicadores de meta e badges de status quitado.
- **Alerta & Despesas (`#e11d48`)**: Vermelho rubi equilibrado para gastos e avisos críticos.
- **Neutros Técnicos**: Tons de Ardósia/Slate (`#0f172a`, `#475569`, `#64748b`, `#cbd5e1`, `#e2e8f0`, `#f8fafc`).
- **Banimento Estrito do Roxo (Purple Ban)**: Todas as instâncias legadas de violeta/magenta/roxo (`#6200ea`, `rgba(98, 0, 234, ...)`) são erradicadas.

## 3. Tipografia & Tratamento Numérico
- **Texto e Títulos**: `Plus Jakarta Sans` — sem serifa geométrica limpa com kerning ajustado (`letterSpacing: -0.015em`).
- **Valores Monetários & Balanços**: `JetBrains Mono` com números tabulares (`font-feature-settings: 'tnum' on, 'zero' on`) para alinhamento contábil impecável em tabelas e cards de resumo.

## 4. Geometria & Linhas de Contorno
- **Bordas**: Em vez de cantos redondos de 16px a 30px ("bolhas"), adota cantos técnicos nítidos de **2px a 4px** para cards, tabelas, modais e botões.
- **Linhas**: Bordas sólidas e finas (`1px solid var(--border-color)`), com realces de 2px a 3px na cor esmeralda ou azul escuro para itens ativos ou sob foco.

## 5. Profundidade & Camadas
- Sem sombras difusas pretas genéricas. Uso de sombras direcionais com matiz de slate/navy (`box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08)` e `0 4px 12px rgba(13, 37, 63, 0.06)`).
- Superfícies no Modo Escuro tratadas com contraste de camadas (`#090d16` para o fundo, `#0f172a` para cartões, `#162032` para tabelas e inputs).

## 6. Micro-interações & Movimento
- Entradas escalonadas com aceleração natural e retorno suave.
- Resposta tátil ao clique com `transform: translateY(1px)` e feedback de foco acessível.
- Suporte total a `prefers-reduced-motion`.
