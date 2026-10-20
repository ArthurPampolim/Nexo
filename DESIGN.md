---
version: 1.1.0
name: Nexo Humanist Ledger
description: Design system financeiro que une o rigor contábil (números tabulares em JetBrains Mono, alinhamento cirúrgico de dados e paleta institucional Navy/Esmeralda) à suavidade ergonômica (raios de 8 a 14px, sombras macias multicamadas e badges acolhedoras).
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
    rounded: "{rounded.sm}"
    fontWeight: 600
  button-action:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    fontWeight: 700
---

# Nexo — Sistema de Design: Humanist Ledger

## 1. Visão Geral
O **Humanist Ledger** é a síntese harmônica entre o **Ledger Preciso** (confiança, métricas auditáveis e contraste institucional) e a interface **Suave & Amigável** (ergonomia tátil, cantos acolhedores e sombras macias). É a linguagem de design utilizada pelos líderes globais do ecossistema fintech moderno (Mercury, Ramp, Wise e Linear).

## 2. Pilares da Mesclagem

### A. Rigor Contábil Preservado (A Alma do Ledger)
- **Tipografia Numérica**: `JetBrains Mono` com números tabulares (`font-feature-settings: 'tnum' 1, 'zero' 1`) para todos os saldos, transações, receitas, despesas e datas.
- **Paleta Institucional**: *Navy Profundo* (`#0d253f`) como âncora de segurança e autoridade, acompanhado de *Azul Petróleo* (`#174665`) e toques de ação em *Verde Esmeralda* (`#00c985`).
- **Alinhamento Contábil**: Tabelas com espaçamento cirúrgico e divisores nítidos.

### B. Acolhimento & Suavidade (A Face Humana)
- **Geometria Confortável**:
  - Cartões de resumo, gráficos, contas e modais: **12px a 14px** de raio (suaves ao olhar, perfeitamente estruturados).
  - Botões de ação, inputs e seletores: **8px** (raio ergonômico ideal para toque e clique).
  - Filtros, status e pílulas: **Pills suaves (9999px)** com micro-espaçamento.
- **Profundidade Macia**: Sombras multicamadas que difundem a luz suavemente (`0 2px 6px rgba(13,37,63,0.05), 0 10px 24px rgba(13,37,63,0.05)`).
- **Micro-interações Agradáveis**: Elevação suave ao passar o mouse (`translateY(-2px)`) com retorno elástico amortecido e foco acessível.
