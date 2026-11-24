const http = require('node:http');

// Inicia o servidor em segundo plano para teste
const { db } = require('./db.js');
const serverProcess = require('./server.js');

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const opt = {
      hostname: '127.0.0.1',
      port: 3030,
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(opt, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- INICIANDO TESTES DO SISTEMA DE RIFAS ---');

  // Aguarda 1s para o servidor subir
  await new Promise(r => setTimeout(r, 1000));

  // 1. Teste de listagem pública de campanhas
  const cRes = await request('/api/campaigns');
  console.log('[TEST 1] Campanhas Públicas Status:', cRes.status);
  if (!Array.isArray(cRes.data) || cRes.data.length === 0) {
    throw new Error('Falha ao listar campanhas públicas');
  }
  const camp = cRes.data[0];
  console.log(`[TEST 1] Campanha encontrada: "${camp.title}", Total de números: ${camp.total_numbers}`);

  // 2. Teste do SIGILO PÚBLICO: /api/campaigns/:id/numbers
  const nRes = await request(`/api/campaigns/${camp.id}/numbers`);
  console.log('[TEST 2] Grade de Números Pública Status:', nRes.status);
  
  // Garante que NENHUM bilhete na rota pública expõe campos sigilosos
  const hasLeakedData = nRes.data.some(t => 
    t.buyer_name !== undefined || 
    t.buyer_phone !== undefined || 
    t.buyer_address !== undefined
  );
  if (hasLeakedData) {
    throw new Error('VIOLAÇÃO DE SIGILO! Dados pessoais vazando na rota pública!');
  }
  console.log('>>> VERIFICADO COM SUCESSO: Rota pública NÃO contém nome, telefone ou endereço!');

  // 3. Teste de reserva pública
  const availTickets = nRes.data.filter(t => t.status === 'available');
  if (availTickets.length < 2) {
    throw new Error('Não há números disponíveis suficientes para o teste');
  }
  const testNums = [availTickets[0].number, availTickets[1].number];

  const rRes = await request(`/api/campaigns/${camp.id}/reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      numbers: testNums,
      name: 'João da Silva Teste',
      phone: '(11) 99887-6655',
      address: 'Rua das Palmeiras, 99 - Bairro Centro'
    }
  });
  console.log('[TEST 3] Reserva Pública Status:', rRes.status, rRes.data.message);
  if (rRes.status !== 200 || !rRes.data.success) {
    throw new Error('Falha ao reservar bilhetes');
  }

  // 4. Teste de bloqueio de acesso sem login na rota restrita
  const unauthRes = await request(`/api/admin/campaigns/${camp.id}/tickets`);
  console.log('[TEST 4] Tentativa de acesso sem login na rota restrita:', unauthRes.status);
  if (unauthRes.status !== 401) {
    throw new Error('Rota restrita deveria retornar 401 Unauthorized sem token!');
  }

  // 5. Teste de Login Admin
  const loginRes = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { username: 'admin', password: 'admin123' }
  });
  console.log('[TEST 5] Login Admin Status:', loginRes.status, 'Usuário:', loginRes.data.user?.name);
  if (loginRes.status !== 200 || !loginRes.data.token) {
    throw new Error('Falha no login');
  }
  const token = loginRes.data.token;

  // 6. Teste de Acesso aos Dados Sigilosos com Login
  const authTicketsRes = await request(`/api/admin/campaigns/${camp.id}/tickets`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('[TEST 6] Acesso aos Dados com Login Status:', authTicketsRes.status);
  const reservedTicket = authTicketsRes.data.tickets.find(t => t.number === testNums[0]);
  console.log('[TEST 6] Dados sigilosos visualizados no Admin:', {
    cota: reservedTicket.number,
    nome: reservedTicket.buyer_name,
    telefone: reservedTicket.buyer_phone,
    endereco: reservedTicket.buyer_address
  });
  if (reservedTicket.buyer_name !== 'João da Silva Teste') {
    throw new Error('Dados do comprador não conferem no Admin!');
  }

  // 7. Teste de Criação de Campanha com QUANTIDADE PERSONALIZADA DE NÚMEROS (ex: 250 números)
  const newCampRes = await request('/api/admin/campaigns', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: {
      title: 'Rifa Personalizada 250 Números',
      prize: 'Kit Gamer Completo',
      total_numbers: 250, // Escolha de quantidade de números!
      description: 'Campanha de teste com 250 cotas',
      draw_date: '15/12/2026'
    }
  });
  console.log('[TEST 7] Criação de Campanha Customizada Status:', newCampRes.status, newCampRes.data.message);
  const customCampId = newCampRes.data.campaign_id;

  // Verifica se gerou exatamente 250 números
  const customTicketsRes = await request(`/api/campaigns/${customCampId}/numbers`);
  console.log('[TEST 7] Quantidade de números gerados na campanha:', customTicketsRes.data.length);
  if (customTicketsRes.data.length !== 250) {
    throw new Error(`Esperado 250 números, encontrado ${customTicketsRes.data.length}`);
  }

  console.log('====================================================');
  console.log(' TODOS OS TESTES PASSARAM COM SUCESSO ABSOLUTO!     ');
  console.log('====================================================');
  process.exit(0);
}

runTests().catch(err => {
  console.error('ERRO NO TESTE:', err);
  process.exit(1);
});
