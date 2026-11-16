import {
  Tag, Utensils, Wallet, Banknote, ChartLine, House, Car, Bus, Bike, Plane, Fuel, Wine, Martini, Coffee, Pizza, Beer,
  ShoppingCart, ShoppingBag, Shirt, Laptop, Smartphone, Tv, Gamepad2, Music, Film, Ticket, Book, BookOpen,
  GraduationCap, HeartPulse, Stethoscope, Pill, Dumbbell, Baby, PawPrint, Dog, Gift, Briefcase, Building2, Landmark,
  PiggyBank, CreditCard, Receipt, Coins, CircleDollarSign, TrendingUp, TrendingDown, ArrowLeftRight, Zap, Droplet,
  Flame, Wifi, Phone, Wrench, Hammer, Scissors, Sparkles, Shield, Umbrella, Sun, Moon, Tent, Mountain, Palmtree,
  Ship, Train, Bed, Sofa, Lamp, Trash2, Heart, Star, Globe, Camera, Palette, Brush, Percent, Calendar, Clock,
  HandCoins, HandHeart, Church, Users, User, Cigarette, Popcorn, Cake, Apple, Carrot, Fish, Milk, IceCreamCone,
  Sandwich, Cookie, Salad, Glasses, Watch, Gem, Crown, Key, Lock, Package, Truck, Store, Factory, Leaf, Flower2,
  TreePine, Recycle, Bolt, Fan, Printer, Router, Server, Cloud, Bitcoin, Euro, DollarSign, Scale, Gavel, FileText,
  Newspaper, Mail, Megaphone, Rocket, Target, Flag, Trophy, Medal, Puzzle, Dices, Guitar, Mic, Headphones, Radio,
  Plus, Pencil, ChevronDown, Search, CornerDownRight, Check, FolderTree, X
} from 'lucide';

// ── Catálogo de ícones (Lucide) ──
// Cada entrada: [nó do ícone, palavras-chave em português para a busca]
const CATALOG = {
  Tag: [Tag, 'etiqueta outros geral'],
  Utensils: [Utensils, 'comida alimentação refeição restaurante'],
  Wallet: [Wallet, 'carteira dinheiro'],
  Banknote: [Banknote, 'dinheiro nota salário renda'],
  ChartLine: [ChartLine, 'investimentos gráfico bolsa'],
  House: [House, 'casa moradia aluguel contas'],
  Car: [Car, 'carro transporte veículo'],
  Bus: [Bus, 'ônibus transporte público'],
  Bike: [Bike, 'bicicleta transporte esporte'],
  Plane: [Plane, 'avião viagem passagem'],
  Fuel: [Fuel, 'combustível gasolina posto'],
  Wine: [Wine, 'vinho bebida bar'],
  Martini: [Martini, 'drink bar balada lazer'],
  Coffee: [Coffee, 'café padaria lanche'],
  Pizza: [Pizza, 'pizza delivery comida'],
  Beer: [Beer, 'cerveja bar bebida'],
  ShoppingCart: [ShoppingCart, 'supermercado compras mercado'],
  ShoppingBag: [ShoppingBag, 'sacola compras loja'],
  Shirt: [Shirt, 'roupas vestuário camiseta'],
  Laptop: [Laptop, 'notebook eletrônicos computador'],
  Smartphone: [Smartphone, 'celular telefone eletrônicos'],
  Tv: [Tv, 'televisão tv streaming'],
  Gamepad2: [Gamepad2, 'jogos videogame lazer'],
  Music: [Music, 'música show'],
  Film: [Film, 'cinema filme'],
  Ticket: [Ticket, 'ingresso evento'],
  Book: [Book, 'livro educação'],
  BookOpen: [BookOpen, 'leitura estudo livro'],
  GraduationCap: [GraduationCap, 'faculdade educação curso formatura'],
  HeartPulse: [HeartPulse, 'saúde médico'],
  Stethoscope: [Stethoscope, 'consulta médico saúde'],
  Pill: [Pill, 'remédio farmácia'],
  Dumbbell: [Dumbbell, 'academia treino esporte'],
  Baby: [Baby, 'bebê filhos criança'],
  PawPrint: [PawPrint, 'pet animais'],
  Dog: [Dog, 'cachorro pet veterinário'],
  Gift: [Gift, 'presente doação'],
  Briefcase: [Briefcase, 'trabalho negócios empresa'],
  Building2: [Building2, 'prédio condomínio empresa'],
  Landmark: [Landmark, 'banco governo impostos'],
  PiggyBank: [PiggyBank, 'poupança economia reserva'],
  CreditCard: [CreditCard, 'cartão crédito'],
  Receipt: [Receipt, 'recibo conta nota'],
  Coins: [Coins, 'moedas dinheiro'],
  CircleDollarSign: [CircleDollarSign, 'dinheiro dólar'],
  TrendingUp: [TrendingUp, 'alta rendimento lucro'],
  TrendingDown: [TrendingDown, 'queda prejuízo'],
  ArrowLeftRight: [ArrowLeftRight, 'transferência troca'],
  Zap: [Zap, 'luz energia elétrica'],
  Droplet: [Droplet, 'água saneamento'],
  Flame: [Flame, 'gás fogo'],
  Wifi: [Wifi, 'internet wifi'],
  Phone: [Phone, 'telefone telefonia'],
  Wrench: [Wrench, 'manutenção conserto oficina'],
  Hammer: [Hammer, 'obra reforma ferramentas'],
  Scissors: [Scissors, 'cabelo salão beleza'],
  Sparkles: [Sparkles, 'beleza limpeza estética'],
  Shield: [Shield, 'seguro proteção'],
  Umbrella: [Umbrella, 'seguro proteção chuva'],
  Sun: [Sun, 'sol verão'],
  Moon: [Moon, 'noite lua'],
  Tent: [Tent, 'camping acampamento'],
  Mountain: [Mountain, 'montanha trilha'],
  Palmtree: [Palmtree, 'praia férias viagem'],
  Ship: [Ship, 'navio cruzeiro'],
  Train: [Train, 'trem metrô'],
  Bed: [Bed, 'hotel cama hospedagem'],
  Sofa: [Sofa, 'sofá móveis casa'],
  Lamp: [Lamp, 'luminária decoração'],
  Trash2: [Trash2, 'lixo'],
  Heart: [Heart, 'coração amor'],
  Star: [Star, 'estrela favorito'],
  Globe: [Globe, 'mundo internacional'],
  Camera: [Camera, 'câmera fotografia'],
  Palette: [Palette, 'arte pintura'],
  Brush: [Brush, 'pincel arte'],
  Percent: [Percent, 'juros taxas desconto'],
  Calendar: [Calendar, 'calendário data'],
  Clock: [Clock, 'relógio tempo'],
  HandCoins: [HandCoins, 'empréstimo pagamento'],
  HandHeart: [HandHeart, 'doação caridade'],
  Church: [Church, 'igreja dízimo religião'],
  Users: [Users, 'família pessoas grupo'],
  User: [User, 'pessoa perfil'],
  Cigarette: [Cigarette, 'cigarro tabaco'],
  Popcorn: [Popcorn, 'pipoca cinema'],
  Cake: [Cake, 'bolo festa aniversário'],
  Apple: [Apple, 'maçã fruta hortifruti'],
  Carrot: [Carrot, 'cenoura hortifruti legumes'],
  Fish: [Fish, 'peixe pescado'],
  Milk: [Milk, 'leite laticínios'],
  IceCreamCone: [IceCreamCone, 'sorvete sobremesa'],
  Sandwich: [Sandwich, 'lanche sanduíche'],
  Cookie: [Cookie, 'biscoito doce'],
  Salad: [Salad, 'salada saudável'],
  Glasses: [Glasses, 'óculos ótica'],
  Watch: [Watch, 'relógio acessório'],
  Gem: [Gem, 'joia luxo'],
  Crown: [Crown, 'coroa premium'],
  Key: [Key, 'chave aluguel'],
  Lock: [Lock, 'cadeado segurança'],
  Package: [Package, 'pacote encomenda'],
  Truck: [Truck, 'frete entrega mudança'],
  Store: [Store, 'loja comércio'],
  Factory: [Factory, 'indústria fábrica'],
  Leaf: [Leaf, 'folha natureza'],
  Flower2: [Flower2, 'flor jardim'],
  TreePine: [TreePine, 'árvore natal'],
  Recycle: [Recycle, 'reciclagem'],
  Bolt: [Bolt, 'parafuso mecânica'],
  Fan: [Fan, 'ventilador clima'],
  Printer: [Printer, 'impressora papelaria'],
  Router: [Router, 'roteador internet'],
  Server: [Server, 'servidor hospedagem'],
  Cloud: [Cloud, 'nuvem assinatura'],
  Bitcoin: [Bitcoin, 'cripto bitcoin'],
  Euro: [Euro, 'euro moeda'],
  DollarSign: [DollarSign, 'dólar moeda'],
  Scale: [Scale, 'balança justiça'],
  Gavel: [Gavel, 'advogado justiça multa'],
  FileText: [FileText, 'documento contrato imposto'],
  Newspaper: [Newspaper, 'jornal revista assinatura'],
  Mail: [Mail, 'correio carta'],
  Megaphone: [Megaphone, 'marketing anúncio'],
  Rocket: [Rocket, 'projeto startup'],
  Target: [Target, 'meta objetivo'],
  Flag: [Flag, 'bandeira meta'],
  Trophy: [Trophy, 'troféu prêmio'],
  Medal: [Medal, 'medalha prêmio'],
  Puzzle: [Puzzle, 'jogo hobby'],
  Dices: [Dices, 'dados jogos aposta'],
  Guitar: [Guitar, 'violão música instrumento'],
  Mic: [Mic, 'microfone podcast'],
  Headphones: [Headphones, 'fone música'],
  Radio: [Radio, 'rádio']
};

// Ícones de interface (não aparecem no seletor)
const UI_ICONS = { Plus, Pencil, Trash2, ChevronDown, Search, CornerDownRight, Check, FolderTree, X };

const toKebab = (pascal) => pascal.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

/** Lista para o seletor: nome Lucide (kebab-case) + palavras-chave de busca. */
export const ICON_LIST = Object.keys(CATALOG).map(pascal => ({
  name: toKebab(pascal),
  search: `${toKebab(pascal).replace(/-/g, ' ')} ${CATALOG[pascal][1]}`.toLowerCase()
}));

const BY_KEBAB = Object.fromEntries(Object.entries(CATALOG).map(([pascal, [node]]) => [toKebab(pascal), node]));
const UI_BY_KEBAB = Object.fromEntries(Object.entries(UI_ICONS).map(([pascal, node]) => [toKebab(pascal), node]));

export const isValidIcon = (name) => Object.prototype.hasOwnProperty.call(BY_KEBAB, name);

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Renderiza o SVG Lucide inline; nomes desconhecidos caem no ícone "tag". */
export function iconSvg(name, size = 18) {
  const node = BY_KEBAB[name] || UI_BY_KEBAB[name] || BY_KEBAB.tag;
  const inner = node.map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ` +
    `class="lucide-icon">${inner}</svg>`;
}

// ── Cores ──
export const COLOR_PALETTE = [
  '#E91E63', '#F44336', '#FF5722', '#FF9800', '#B7791F', '#8BC34A', '#4CAF50', '#059669',
  '#00BCD4', '#0284C7', '#3F51B5', '#7C4DFF', '#9C27B0', '#BA68C8', '#795548', '#607D8B', '#36454f', '#9e9e9e'
];

export const isHexColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

/** Cor do ícone sobre o fundo: branco, ou grafite se o fundo for muito claro. */
export function inkFor(hex) {
  if (!isHexColor(hex)) return '#ffffff';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#212b31' : '#ffffff';
}

// ── Categorias padrão ──
// Os nomes são os mesmos gravados nas transações antigas, então nada fica órfão.
export const DEFAULT_CATEGORIES = [
  { Nome: 'Moradia / Contas', Icone: 'house', Cor: '#3F51B5', Tipo: 'DESPESA' },
  { Nome: 'Alimentação', Icone: 'utensils', Cor: '#E91E63', Tipo: 'DESPESA' },
  { Nome: 'Transporte', Icone: 'car', Cor: '#FF9800', Tipo: 'DESPESA' },
  { Nome: 'Saúde', Icone: 'heart-pulse', Cor: '#00BCD4', Tipo: 'DESPESA' },
  { Nome: 'Educação', Icone: 'book-open', Cor: '#607D8B', Tipo: 'DESPESA' },
  { Nome: 'Lazer', Icone: 'martini', Cor: '#9C27B0', Tipo: 'DESPESA' },
  { Nome: 'Supermercado', Icone: 'shopping-cart', Cor: '#795548', Tipo: 'DESPESA' },
  { Nome: 'Bar / Restaurante', Icone: 'wine', Cor: '#BA68C8', Tipo: 'DESPESA' },
  { Nome: 'Eletrônicos', Icone: 'laptop', Cor: '#607D8B', Tipo: 'DESPESA' },
  { Nome: 'Roupas', Icone: 'shirt', Cor: '#FF5722', Tipo: 'DESPESA' },
  { Nome: 'Salário', Icone: 'banknote', Cor: '#F44336', Tipo: 'RECEITA' },
  { Nome: 'Investimentos', Icone: 'chart-line', Cor: '#8BC34A', Tipo: 'RECEITA' },
  { Nome: 'Outros', Icone: 'tag', Cor: '#9e9e9e', Tipo: 'DESPESA' }
].map((c, i) => ({ ...c, ParentId: null, Ordem: i }));
