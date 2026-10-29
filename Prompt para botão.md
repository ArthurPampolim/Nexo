# Prompt para botão:



Você recebeu a tarefa de integrar um componente React existente na base de código.



A base de código deve suportar:



\* Estrutura de projeto do shadcn

\* Tailwind CSS

\* TypeScript



Se não suportar, forneça instruções sobre como configurar o projeto via CLI do shadcn e instalar o Tailwind ou TypeScript.



Determine o caminho padrão para componentes e estilos.

Se o caminho padrão para os componentes não for `/componentes/ui`, forneça instruções explicando por que é importante criar esta pasta.



Copie e cole este componente na pasta `/componentes/ui`:



```tsx

// interactive-hover-button.tsx

import React from "react";

import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";



interface InteractiveHoverButtonProps

&nbsp; extends React.ButtonHTMLAttributes<HTMLButtonElement> {

&nbsp; text?: string;

}



const InteractiveHoverButton = React.forwardRef<

&nbsp; HTMLButtonElement,

&nbsp; InteractiveHoverButtonProps

>(({ text = "Button", className, ...props }, ref) => {

&nbsp; return (

&nbsp;   <button

&nbsp;     ref={ref}

&nbsp;     className={cn(

&nbsp;       "group relative w-32 cursor-pointer overflow-hidden rounded-full border bg-background p-2 text-center font-semibold",

&nbsp;       className,

&nbsp;     )}

&nbsp;     ...props}

&nbsp;   >

&nbsp;     <span className="inline-block translate-x-1 transition-all duration-300 group-hover:translate-x-12 group-hover:opacity-0">

&nbsp;       {text}

&nbsp;     </span>

&nbsp;     <div className="absolute top-0 z-10 flex h-full w-full translate-x-12 items-center justify-center gap-2 text-primary-foreground opacity-0 transition-all duration-300 group-hover:-translate-x-1 group-hover:opacity-100">

&nbsp;       <span>{text}</span>

&nbsp;       <ArrowRight />

&nbsp;     </div>

&nbsp;     <div className="absolute left-\[20%] top-\[40%] h-2 w-2 scale-\[1] rounded-lg bg-primary transition-all duration-300 group-hover:left-\[0%] group-hover:top-\[0%] group-hover:h-full group-hover:w-full group-hover:scale-\[1.8] group-hover:bg-primary"></div>

&nbsp;   </button>

&nbsp; );

});



InteractiveHoverButton.displayName = "InteractiveHoverButton";



export { InteractiveHoverButton };





// demo.tsx

import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";



function InteractiveHoverButtonDemo() {

&nbsp; return (

&nbsp;   <div className="relative justify-center">

&nbsp;     <InteractiveHoverButton />

&nbsp;   </div>

&nbsp; );

}



export { InteractiveHoverButtonDemo };



```



Instale as dependências do NPM:



```bash

npm install lucide-react



```



\*\*Diretrizes de Implementação\*\*



1\. Analise a estrutura do componente e identifique todas as dependências necessárias.

2\. Revise os argumentos (props) e o estado do componente.

3\. Identifique quaisquer provedores de contexto ou hooks necessários e instale-os.

4\. Perguntas a fazer:

\* Quais dados/props serão passados para este componente?

\* Existem requisitos específicos de gerenciamento de estado?

\* Existem ativos necessários (imagens, ícones, etc.)?

\* Qual é o comportamento responsivo esperado?

\* Qual é o melhor lugar para usar este componente no aplicativo?







\*\*Passos para integração\*\*

0\. Copie e cole todo o código acima nos diretórios corretos.



1\. Instale as dependências externas.

2\. Preencha os ativos de imagem com imagens de banco de imagens do Unsplash que você sabe que existem.

3\. Use ícones do `lucide-react` para SVGs ou logotipos, caso o componente exija.




