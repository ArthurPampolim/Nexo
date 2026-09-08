// src/charts.js

// Formatador de moeda
const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Variáveis para armazenar as instâncias dos gráficos e evitar sobreposição
let expensesChartInstance = null;
let historicoChartInstance = null;
let balancoMesChartInstance = null;

export const ChartManager = {

    // Função principal que orquestra a atualização de todos os gráficos
    updateDashboardCharts: function (allTransactions, selectedYYYYMM) {
        this.renderExpensesChart(allTransactions, selectedYYYYMM);
        this.renderMonthlyBalanceChart(allTransactions, selectedYYYYMM);
        this.renderHistoricalChart(allTransactions);
    },

    // 1. GRÁFICO DE ROSCA (Despesas por Categoria do Mês Atual)
    renderExpensesChart: function (allTransactions, selectedYYYYMM) {
        const canvas = document.getElementById('expensesChart');
        if (!canvas) return;

        const monthlyTx = allTransactions.filter(t => {
            if (!t.Data || t.Tipo !== 'DESPESA' || (t.Categoria && t.Categoria.toLowerCase().includes('transfer'))) return false;
            return String(t.Data).slice(0, 7) === selectedYYYYMM;
        });

        const categoryTotals = monthlyTx.reduce((acc, t) => {
            const cat = t.Categoria || 'Outros';
            acc[cat] = (acc[cat] || 0) + (parseFloat(t.Valor) || 0);
            return acc;
        }, {});

        const labels = Object.keys(categoryTotals);
        const dataValues = Object.values(categoryTotals);

        if (expensesChartInstance) expensesChartInstance.destroy();

        expensesChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: labels.length > 0 ? labels : ['Sem despesas'],
                datasets: [{
                    data: dataValues.length > 0 ? dataValues : [1],
                    backgroundColor: labels.length > 0 ?
                        ['#0d253f', '#174665', '#00c985', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4'] :
                        ['#e2e8f0'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, cutout: '70%',
                plugins: {
                    legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: (context) => labels.length > 0 ? ` ${context.label}: ${currencyFormatter.format(context.raw)}` : ' Sem dados'
                        }
                    }
                }
            }
        });
    },

    // 2. GRÁFICO DE BARRAS (Balanço do Mês: Receitas x Despesas)
    renderMonthlyBalanceChart: function (allTransactions, selectedYYYYMM) {
        const canvas = document.getElementById('balancoMesChart');
        if (!canvas) return;

        let receitas = 0;
        let despesas = 0;

        allTransactions.forEach(t => {
            if (!t.Data || (t.Categoria && t.Categoria.toLowerCase().includes('transfer'))) return;
            if (String(t.Data).slice(0, 7) === selectedYYYYMM) {
                if (t.Tipo === 'RECEITA') receitas += parseFloat(t.Valor) || 0;
                if (t.Tipo === 'DESPESA') despesas += parseFloat(t.Valor) || 0;
            }
        });

        if (balancoMesChartInstance) balancoMesChartInstance.destroy();

        balancoMesChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['Receitas', 'Despesas'],
                datasets: [{
                    data: [receitas, despesas],
                    backgroundColor: ['#00c985', '#F44336'], // Verde Esmeralda e Vermelho
                    borderRadius: 6,
                    barPercentage: 0.6
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: { label: (context) => ` ${currencyFormatter.format(context.raw)}` }
                    }
                },
                scales: {
                    y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { callback: (val) => 'R$ ' + val } },
                    x: { grid: { display: false } }
                }
            }
        });
    },

    // 3. GRÁFICO HISTÓRICO (Últimos 6 meses)
    renderHistoricalChart: function (allTransactions) {
        const canvas = document.getElementById('historicoChart');
        if (!canvas) return;

        // Gera os últimos 6 meses (ex: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
        const last6Months = [];
        const monthNames = [];
        const date = new Date();

        for (let i = 5; i >= 0; i--) {
            const d = new Date(date.getFullYear(), date.getMonth() - i, 1);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            last6Months.push(`${yyyy}-${mm}`);
            monthNames.push(d.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase());
        }

        const histReceitas = [0, 0, 0, 0, 0, 0];
        const histDespesas = [0, 0, 0, 0, 0, 0];

        allTransactions.forEach(t => {
            if (!t.Data || (t.Categoria && t.Categoria.toLowerCase().includes('transfer'))) return;
            const tMonth = String(t.Data).slice(0, 7);
            const index = last6Months.indexOf(tMonth);

            if (index !== -1) {
                if (t.Tipo === 'RECEITA') histReceitas[index] += parseFloat(t.Valor) || 0;
                if (t.Tipo === 'DESPESA') histDespesas[index] += parseFloat(t.Valor) || 0;
            }
        });

        if (historicoChartInstance) historicoChartInstance.destroy();

        historicoChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: monthNames,
                datasets: [
                    {
                        label: 'Receitas',
                        data: histReceitas,
                        borderColor: '#00c985',
                        backgroundColor: 'rgba(0, 201, 133, 0.1)',
                        borderWidth: 3,
                        tension: 0.4, // Curva suave
                        fill: true
                    },
                    {
                        label: 'Despesas',
                        data: histDespesas,
                        borderColor: '#F44336',
                        backgroundColor: 'transparent',
                        borderWidth: 3,
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: { mode: 'index', intersect: false, callbacks: { label: (context) => ` ${context.dataset.label}: ${currencyFormatter.format(context.raw)}` } }
                },
                scales: {
                    y: { beginAtZero: true, grid: { borderDash: [5, 5] }, ticks: { callback: (val) => 'R$ ' + val } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
};