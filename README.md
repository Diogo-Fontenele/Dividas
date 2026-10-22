# Planejamento Familiar

App instalável (PWA) para Android: cadastro de dívidas e receitas da família, lembrete de vencimento, juros de atraso, empréstimos por parcela e relatório anual (saldo positivo/negativo por mês).

- **Banco de dados local** no celular (IndexedDB) — nenhum dado sai do aparelho.
- **Funciona offline** depois da primeira abertura.
- **Sem servidor, sem custo**: são só arquivos estáticos (HTML/CSS/JS).

## Como publicar de graça (GitHub Pages) e compartilhar

1. Crie uma conta em github.com e um repositório **público** novo (ex.: `planejamento-familiar`).
2. Envie todos os arquivos desta pasta para a raiz do repositório (botão **Add file → Upload files**).
3. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. Em ~1 minuto o app estará em `https://SEU-USUARIO.github.io/planejamento-familiar/`.
5. Mande esse link para a família. No Android (Chrome): abra o link → menu ⋮ → **Instalar app**.

Alternativas gratuitas equivalentes: Netlify Drop (arraste a pasta em app.netlify.com/drop) ou Cloudflare Pages.

## Quer um arquivo .APK?

Com o link já publicado, acesse **pwabuilder.com**, cole a URL, escolha **Android** e baixe o pacote. Ele gera um `.apk` para instalar direto (e um `.aab` caso um dia queira a Google Play). Os dados continuam locais no celular.

## Como funcionam os avisos de vencimento

| Recurso | Como funciona |
| --- | --- |
| **Calendário** (recomendado) | Ao salvar uma dívida aparece o botão **📅 Calendário**; em **Mais** há “Salvar todos os vencimentos”. Gera um evento com alarme na hora escolhida, no dia de cada vencimento em aberto (próximos 12 meses). |
| **Notificação do app** | Ao abrir o app, avisa o que vence hoje e o que está em atraso. No Chrome com o app instalado, também tenta avisar em segundo plano. |

Apps web não conseguem agendar alarmes exatos sozinhos no Android — por isso o calendário é o jeito garantido de ser avisado no dia.

## Regras de cálculo

- **Conta que se repete**: escolha se o valor é **fixo** (mesmo valor todo mês, ex.: aluguel, internet) ou **variável** (muda todo mês, ex.: luz, água, cartão).
  - *Fixo*: informe o valor mensal, o fim do contrato (opcional) e os **reajustes** (mês em que o novo valor passa a valer). Também dá para reajustar depois: toque na conta no mês desejado → **Alterar valor / reajuste** → “neste mês e nos próximos”.
  - *Variável*: o valor informado no cadastro é só uma estimativa. Todo mês, toque na conta e informe o valor real antes de pagar.
- **Receitas** seguem a mesma lógica (ex.: aluguel recebido fixo que muda de valor em certo mês).
- **Juros por atraso**: valor fixo em R$ cadastrado em cada dívida. Se pagar depois do vencimento, esse valor é somado ao total.
- **Empréstimo/Financiamento**: informe valor, parcela, juros mensal, nº de parcelas e quantas já foram pagas; o app mostra restantes e valor a pagar.

## Backup

Em **Mais → Exportar backup** gera um `.json`. Para levar os dados a outro celular, importe o arquivo lá (os dados são mesclados).

## Estrutura

```
index.html  style.css  app.js  logic.js  db.js  sw.js  manifest.webmanifest  icons/
```
