<div align="center">

# Nexo

**Aplicação web de finanças pessoais: contas, cartões, metas, planejamento e calendário financeiro em um só lugar.**

![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?logo=firebase&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-gráficos-FF6384?logo=chartdotjs&logoColor=white)

</div>

---

## Sobre o projeto

O Nexo nasceu para responder uma pergunta simples: **"para onde está indo o meu dinheiro?"**. Ele reúne em uma única interface o controle de receitas e despesas, faturas de cartão de crédito, custos fixos, objetivos de poupança e o planejamento mensal, tudo com dados privados por usuário e suporte a tema claro e escuro.

O projeto foi construído do zero, sem framework de interface, com foco em três pontos:

- **Experiência de uso:** design system próprio ("Humanist Ledger"), animações suaves e fluxos curtos para lançar e consultar dados.
- **Segurança:** cada usuário só enxerga os próprios dados, garantido por regras de segurança no banco e não apenas pela interface.
- **Código enxuto:** JavaScript puro com módulos ES, Vite como bundler e Firebase como backend gerenciado.

<!--
Adicione aqui capturas de tela do sistema. Exemplo:

![Dashboard](docs/screenshots/dashboard.png)
![Calendário](docs/screenshots/calendario.png)
-->

## Funcionalidades

| Módulo | O que faz |
|---|---|
| **Dashboard** | Saldo atual, receitas e despesas do mês, saldo por conta, gráficos de balanço (6 meses), despesas por categoria e alertas de caixa. |
| **Transações** | Lançamento de despesas e receitas com atalhos de data, calendário, tags, observação, repetição mensal e opção de ignorar a transação nos totais. Filtros, ordenação, paginação e painel lateral de detalhes. |
| **Cartões e faturas** | Cartões visuais com limite usado, painel lateral por cartão com os lançamentos da fatura e pagamento da fatura em um clique. |
| **Custos fixos** | Cadastro de contas recorrentes, pagamento mensal, exceções por mês (alterar só "este mês") e resumo de quitados e pendentes. |
| **Objetivos** | Metas com valor alvo e prazo, aporte mensal sugerido, depósitos, resgates e histórico. |
| **Contas** | Saldos consolidados, transferências entre contas e saldo inicial. |
| **Planejamento mensal** | Assistente que define a renda, a meta de economia e o limite por categoria, e compara o planejado com o gasto real. |
| **Calendário** | Visão semanal com arrastar e soltar, mini calendário mensal e vencimentos de custos fixos e faturas inseridos automaticamente. |
| **Categorias** | Categorias com ícone e cor personalizáveis. |
| **Perfil e preferências** | Cadastro do usuário, tema claro e escuro, idioma e moeda. |

## Destaques técnicos

- **Isolamento de dados por usuário.** Todo documento carrega o `userId` do dono, as consultas filtram por ele, e as [regras do Firestore](firestore.rules) negam qualquer acesso a documentos de outras contas ou a coleções não declaradas.
- **Defesa contra XSS.** Todo texto digitado pelo usuário passa por escape antes de ir para o HTML, e a página usa uma Content Security Policy restritiva.
- **Autenticação.** Login e cadastro com Firebase Authentication, validação de força de senha, recuperação de senha e bloqueio progressivo após tentativas falhas.
- **Design system próprio.** Tokens de cor, raio, sombra e tipografia em variáveis CSS, com tema escuro por sobreposição de variáveis, números tabulares para dados financeiros e respeito à preferência de movimento reduzido do sistema.
- **Componentes sem dependências.** Menus com indicador deslizante animado, diálogos de confirmação, seletor de datas, painéis laterais e calendário semanal com arrastar e soltar, tudo escrito à mão.
- **Cálculo financeiro cuidadoso.** Arredondamento em centavos para evitar erros de ponto flutuante nos saldos e tratamento de transações futuras, ignoradas e transferências nos totais.

## Tecnologias

- **Interface:** HTML, CSS e JavaScript (ES Modules)
- **Build:** [Vite](https://vitejs.dev/)
- **Backend:** [Firebase](https://firebase.google.com/) (Authentication e Cloud Firestore)
- **Gráficos:** [Chart.js](https://www.chartjs.org/)
- **Componentes de apoio:** [Choices.js](https://github.com/Choices-js/Choices) e Font Awesome

## Como executar

**Pré-requisitos:** Node.js 18 ou superior e um projeto no [Firebase](https://console.firebase.google.com/) com Authentication (e-mail e senha) e Firestore ativados.

```bash
# 1. Clonar e instalar
git clone https://github.com/ArthurPampolim/Nexo.git
cd Nexo
npm install

# 2. Configurar o Firebase
cp .env.example .env
# preencha o .env com as chaves do seu projeto

# 3. Rodar em desenvolvimento
npm run dev
```

Para gerar a versão de produção, use `npm run build`. O resultado fica em `dist/`.

### Regras de segurança do Firestore

Publique as regras do projeto antes de usar o sistema com dados reais. Sem elas, o banco fica aberto a qualquer usuário autenticado:

```bash
firebase deploy --only firestore:rules
```

## Estrutura

```
src/
├── main.js          # Lógica da aplicação e módulos de tela
├── charts.js        # Gráficos do dashboard
├── categories.js    # Categorias padrão, ícones e cores
├── firebase.js      # Inicialização do Firebase (via variáveis de ambiente)
├── style.css        # Design system e estilos
└── assets/          # Logotipos
firestore.rules      # Regras de segurança do banco
DESIGN.md            # Documentação do design system
```

## Próximos passos

- Anexar comprovantes às transações
- Marcar despesas como pagas ou agendadas, com efeito nos saldos
- Relatórios exportáveis (PDF e CSV)
- Testes automatizados para os cálculos financeiros
- Separar `main.js` em módulos por tela

## Autor

**Arthur Pampolim**

[GitHub](https://github.com/ArthurPampolim)
