# 🎟️ Sistema de Rifas e Marcação de Números

Sistema simplificado, moderno e seguro para controle de reservas de números em rifas e campanhas, desenvolvido com **Node.js**, **Express**, **SQLite nativo (node:sqlite)** e **Tailwind CSS**.

---

## 🌟 Como o Sistema Funciona (Sem Pagamento)

O sistema foi ajustado para focar estritamente na **marcação e identificação dos participantes**:

1. **Escolha dos Números na Área Pública**:
   - O participante acessa o site, visualiza a grade com todos os números (`01..100`, `001..500`, etc.) e seleciona os números desejados.
   - Pode clicar individualmente ou usar os atalhos rápidos (`+1 Aleatório`, `+5 da Sorte`, `+10 Cotas`).
   - Clica em **"Marcar Meus Números"**.

2. **Preenchimento dos Dados**:
   - O participante informa **Nome Completo**, **WhatsApp/Telefone com DDD** e **Endereço Completo de Entrega**.
   - Clica em **"Confirmar Escolha de Números"**.
   - Os números são marcados instantaneamente como **Reservados**.

3. **Sigilo Absoluto dos Dados (LGPD)**:
   - Para qualquer outra pessoa que acessar o site público, os números marcados aparecem apenas com a cor âmbar e o status **"Reservado"**.
   - **Nenhum visitante comum consegue ver o nome, telefone ou endereço** de quem marcou os números — nem mesmo inspecionando a rede ou o código-fonte da página.

4. **Painel do Administrador (`/admin`)**:
   - Apenas a organização, após efetuar login (`admin` / `admin123`), tem acesso à lista com:
     - **Número da Cota**
     - **Nome Completo**
     - **Telefone / WhatsApp** (com link direto de 1 clique para conversar no WhatsApp)
     - **Endereço Completo para Envio do Prêmio**
     - **Data e Hora da Reserva**
     - Botão para **Liberar Cota** (caso alguém desista ou queira cancelar a reserva).

5. **Configuração de Quantidade de Números da Campanha**:
   - Ao criar uma nova rifa no painel administrativo, basta definir:
     - **Título**
     - **Prêmio**
     - **Quantidade de Números da Rifa** (atalhos para 50, 100, 200, 500, 1000 ou qualquer número customizado).
   - Não há cobrança, chaves Pix ou valores a preencher.

6. **Sorteador Oficial Integrado**:
   - Botão no admin para realizar o sorteio entre todos os números reservados, com animação de roleta e exibição do vencedor e seus dados de contato.

---

## 🚀 Como Executar

Se o servidor já estiver rodando no seu terminal, basta reiniciar para carregar as alterações:
1. No terminal do PowerShell onde está rodando, pressione **Ctrl + C**.
2. Digite novamente:
```powershell
node server.js
```
*(ou execute pelo arquivo `iniciar-rifas.bat`)*

- **Site Público:** [http://localhost:3030](http://localhost:3030)
- **Painel Admin:** [http://localhost:3030/admin](http://localhost:3030/admin)
- **Login Padrão:** `admin` | **Senha:** `admin123`
