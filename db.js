const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// Garante o diretório do banco de dados (no Vercel utiliza /tmp pois o disco raiz é somente leitura)
const isVercel = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
const dataDir = isVercel ? '/tmp' : path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'rifas.db');
const db = new DatabaseSync(dbPath);

// Configurações do SQLite para performance e integridade
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return check === hash;
}

// Criação das tabelas
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      prize TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 10.0,
      total_numbers INTEGER NOT NULL DEFAULT 100,
      draw_date TEXT,
      pix_key TEXT,
      pix_type TEXT,
      pix_beneficiary TEXT,
      image_url TEXT,
      status TEXT DEFAULT 'active',
      winner_number INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      buyer_name TEXT,
      buyer_phone TEXT,
      buyer_address TEXT,
      reserved_at DATETIME,
      paid_at DATETIME,
      notes TEXT,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, number)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_campaign ON tickets(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(campaign_id, status);
  `);

  // Unifica status: não há mais cobrança, tudo que estiver marcado é reservado
  db.exec("UPDATE tickets SET status = 'reserved' WHERE status = 'paid';");

  // Garante o usuário admin padrão se não houver usuários
  const userCheck = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCheck.count === 0) {
    const { hash, salt } = hashPassword('admin123');
    const insertUser = db.prepare(
      'INSERT INTO users (username, password_hash, salt, name) VALUES (?, ?, ?, ?)'
    );
    insertUser.run('admin', hash, salt, 'Administrador');
    console.log('[DB] Usuário administrador padrão criado: login "admin", senha "admin123"');
  }

  // Garante uma campanha de demonstração se não houver nenhuma
  const campCheck = db.prepare('SELECT COUNT(*) as count FROM campaigns').get();
  if (campCheck.count === 0) {
    createCampaign({
      title: 'Rifa Especial - Smart TV 55" 4K Crystal UHD',
      description: 'Escolha seus números da sorte e preencha seus dados para participar do sorteio!',
      prize: 'Smart TV Samsung 55" 4K',
      total_numbers: 100,
      draw_date: '31/12/2026',
      image_url: 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=800&q=80'
    });

    const demoCamp = db.prepare('SELECT id FROM campaigns ORDER BY id DESC LIMIT 1').get();
    if (demoCamp) {
      reserveTickets(demoCamp.id, [7, 13], 'Carlos Alberto Silva', '(11) 98765-4321', 'Rua das Flores, 120 - São Paulo/SP');
      reserveTickets(demoCamp.id, [24, 77], 'Mariana Rodrigues Costa', '(21) 97654-3210', 'Av. Brasil, 450 - Rio de Janeiro/RJ');
    }

    console.log('[DB] Campanha inicial de demonstração criada com 100 números!');
  }
}

// Criar campanha com geração rápida de bilhetes
function createCampaign(data) {
  const total = parseInt(data.total_numbers, 10) || 100;
  if (total < 1 || total > 100000) {
    throw new Error('A quantidade de números deve ser entre 1 e 100.000');
  }

  const insertCamp = db.prepare(`
    INSERT INTO campaigns (
      title, description, prize, price, total_numbers, draw_date,
      pix_key, pix_type, pix_beneficiary, image_url, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = insertCamp.run(
    data.title,
    data.description || '',
    data.prize,
    0,
    total,
    data.draw_date || '',
    '',
    '',
    '',
    data.image_url || '',
    data.status || 'active'
  );

  const campaignId = Number(result.lastInsertRowid);

  // Gera os números em lote (transação)
  db.exec('BEGIN TRANSACTION;');
  try {
    const insertTicket = db.prepare(`
      INSERT INTO tickets (campaign_id, number, status)
      VALUES (?, ?, 'available')
    `);

    for (let i = 1; i <= total; i++) {
      insertTicket.run(campaignId, i);
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return campaignId;
}

// Reservar números (área pública)
function reserveTickets(campaignId, numbers, buyerName, buyerPhone, buyerAddress) {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    throw new Error('Selecione pelo menos um número.');
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    const checkStmt = db.prepare(`
      SELECT number, status FROM tickets 
      WHERE campaign_id = ? AND number = ?
    `);

    const updateStmt = db.prepare(`
      UPDATE tickets 
      SET status = 'reserved',
          buyer_name = ?,
          buyer_phone = ?,
          buyer_address = ?,
          reserved_at = CURRENT_TIMESTAMP
      WHERE campaign_id = ? AND number = ? AND status = 'available'
    `);

    const unavailable = [];

    for (const num of numbers) {
      const ticket = checkStmt.get(campaignId, num);
      if (!ticket) {
        unavailable.push(`Número ${num} não existe`);
      } else if (ticket.status !== 'available') {
        unavailable.push(`Número ${num} já está ${ticket.status === 'paid' ? 'pago' : 'reservado'}`);
      }
    }

    if (unavailable.length > 0) {
      throw new Error(`Alguns números não estão mais disponíveis: ${unavailable.join(', ')}`);
    }

    for (const num of numbers) {
      const res = updateStmt.run(buyerName, buyerPhone, buyerAddress, campaignId, num);
      if (res.changes === 0) {
        throw new Error(`O número ${num} acabou de ser reservado por outra pessoa.`);
      }
    }

    db.exec('COMMIT;');
    return { success: true, count: numbers.length };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// Inicializa no carregamento do módulo
initDatabase();

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  createCampaign,
  reserveTickets
};
