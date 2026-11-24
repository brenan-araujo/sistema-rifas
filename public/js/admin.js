// Lógica do Painel Administrativo de Rifas
let token = localStorage.getItem('rifas_token');
let currentAdminCampaign = null;
let adminCampaigns = [];
let adminTickets = [];
let debounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// Headers autenticados
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

// Checar sessão ativa
async function checkAuth() {
  if (!token) {
    showLogin();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (!res.ok) {
      throw new Error('Sessão expirada');
    }
    showAdmin();
    await loadAdminCampaigns();
  } catch (err) {
    showLogin();
  }
}

function showLogin() {
  localStorage.removeItem('rifas_token');
  token = null;
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminApp').classList.add('hidden');
}

function showAdmin() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminApp').classList.remove('hidden');
}

// Login
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errorBox = document.getElementById('loginError');
  const btn = document.getElementById('btnLogin');

  errorBox.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Autenticando...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro ao realizar login.');
    }

    token = data.token;
    localStorage.setItem('rifas_token', token);
    showAdmin();
    await loadAdminCampaigns();
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar no Painel';
  }
}

// Logout
async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
  } catch (err) {
    console.error(err);
  }
  showLogin();
}

// Carregar Campanhas no Admin
async function loadAdminCampaigns() {
  try {
    const res = await fetch('/api/admin/campaigns', { headers: getAuthHeaders() });
    if (res.status === 401) {
      showLogin();
      return;
    }

    adminCampaigns = await res.json();
    const select = document.getElementById('adminCampaignSelect');

    if (!adminCampaigns || adminCampaigns.length === 0) {
      select.innerHTML = '<option value="">Nenhuma campanha cadastrada</option>';
      renderStats(null);
      renderAdminTickets([]);
      return;
    }

    select.innerHTML = adminCampaigns.map(c => `
      <option value="${c.id}" ${currentAdminCampaign && currentAdminCampaign.id === c.id ? 'selected' : ''}>
        ${c.title} (${c.total_numbers} números)
      </option>
    `).join('');

    // Se nenhuma campanha estiver selecionada, seleciona a primeira
    const targetId = currentAdminCampaign ? currentAdminCampaign.id : adminCampaigns[0].id;
    const found = adminCampaigns.find(c => c.id === targetId) || adminCampaigns[0];
    switchAdminCampaign(found.id);
  } catch (err) {
    console.error('Erro ao carregar campanhas admin:', err);
  }
}

// Alternar Campanha
async function switchAdminCampaign(campaignId) {
  const id = parseInt(campaignId, 10);
  currentAdminCampaign = adminCampaigns.find(c => c.id === id);
  if (!currentAdminCampaign) return;

  renderStats(currentAdminCampaign);
  await loadAdminTickets();
}

// Renderizar Métricas de Cotas
function renderStats(camp) {
  if (!camp) {
    document.getElementById('statTotalNumbers').textContent = '0';
    document.getElementById('statReservedCount').textContent = '0';
    document.getElementById('statAvailableCount').textContent = '0';
    document.getElementById('statProgressPct').textContent = '0%';
    return;
  }

  const total = camp.total_numbers || 1;
  const reserved = camp.reserved_count || 0;
  const available = camp.available_count || 0;
  const pct = Math.min(100, Math.round((reserved / total) * 100));

  document.getElementById('statTotalNumbers').textContent = total;
  document.getElementById('statReservedCount').textContent = reserved;
  document.getElementById('statAvailableCount').textContent = available;
  document.getElementById('statProgressPct').textContent = `${pct}%`;
}

// Carregar Bilhetes e Dados Sigilosos
async function loadAdminTickets() {
  if (!currentAdminCampaign) return;

  const search = document.getElementById('adminSearchInput').value.trim();
  const status = document.getElementById('adminStatusFilter').value;

  let url = `/api/admin/campaigns/${currentAdminCampaign.id}/tickets?`;
  if (search) url += `search=${encodeURIComponent(search)}&`;
  if (status) url += `status=${encodeURIComponent(status)}&`;

  try {
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (res.status === 401) {
      showLogin();
      return;
    }

    const data = await res.json();
    adminTickets = data.tickets || [];
    renderAdminTickets(adminTickets);
  } catch (err) {
    console.error('Erro ao buscar bilhetes:', err);
  }
}

// Formatar número com zeros à esquerda
function formatNumber(num, total) {
  if (total <= 100) return String(num).padStart(2, '0');
  if (total <= 1000) return String(num).padStart(3, '0');
  return String(num).padStart(4, '0');
}

// Renderizar Tabela de Participantes com Dados Sigilosos
function renderAdminTickets(tickets) {
  const tbody = document.getElementById('adminTicketsTableBody');
  const emptyNotice = document.getElementById('tableEmptyNotice');
  const total = currentAdminCampaign ? currentAdminCampaign.total_numbers : 100;

  if (!tickets || tickets.length === 0) {
    tbody.innerHTML = '';
    emptyNotice.classList.remove('hidden');
    return;
  }

  emptyNotice.classList.add('hidden');

  tbody.innerHTML = tickets.map(t => {
    const formattedNum = formatNumber(t.number, total);
    const cleanPhone = (t.buyer_phone || '').replace(/\D/g, '');

    // Status Badge
    let statusBadge = '';
    let actionsHtml = '';

    if (t.status !== 'available') {
      statusBadge = '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">Reservado</span>';
      actionsHtml = `
        <button onclick="updateTicketStatus(${t.id}, 'available')" class="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg border border-rose-200 transition-colors" title="Liberar cota para outros participantes">
          Liberar Cota
        </button>
      `;
    } else {
      statusBadge = '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600">Disponível</span>';
      actionsHtml = `<span class="text-slate-400 italic">Livre</span>`;
    }

    // Link WhatsApp
    const waLink = cleanPhone ? `
      <a href="https://wa.me/55${cleanPhone}?text=${encodeURIComponent(`Olá ${t.buyer_name || ''}! Entramos em contato referente à sua cota nº ${formattedNum} na rifa "${currentAdminCampaign.title}".`)}" target="_blank" class="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-bold ml-1.5" title="Conversar no WhatsApp">
        <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
        <span>Abrir WhatsApp</span>
      </a>
    ` : '';

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4 font-mono font-black text-indigo-700 text-sm">
          #${formattedNum}
        </td>
        <td class="py-3 px-4">
          ${statusBadge}
        </td>
        <td class="py-3 px-4 font-bold text-slate-800">
          ${t.buyer_name || '<span class="text-slate-400 font-normal italic">-</span>'}
        </td>
        <td class="py-3 px-4 font-medium text-slate-700">
          ${t.buyer_phone ? `${t.buyer_phone} ${waLink}` : '<span class="text-slate-400 font-normal italic">-</span>'}
        </td>
        <td class="py-3 px-4 text-slate-600 max-w-xs truncate" title="${t.buyer_address || ''}">
          ${t.buyer_address || '<span class="text-slate-400 font-normal italic">-</span>'}
        </td>
        <td class="py-3 px-4 text-slate-500 whitespace-nowrap">
          ${t.reserved_at ? formatDateTime(t.reserved_at) : '<span class="text-slate-400 font-normal italic">-</span>'}
        </td>
        <td class="py-3 px-4 text-right whitespace-nowrap">
          ${actionsHtml}
        </td>
      </tr>
    `;
  }).join('');
}

// Formatar data e hora
function formatDateTime(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch (e) {
    return isoString;
  }
}

// Alterar Status do Bilhete (Liberar cota)
async function updateTicketStatus(ticketId, newStatus) {
  if (!confirm('Tem certeza que deseja cancelar esta reserva e liberar o número novamente?')) return;

  try {
    const res = await fetch(`/api/admin/tickets/${ticketId}/status`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status: newStatus })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao atualizar.');

    // Recarrega campanhas e tabela
    await loadAdminCampaigns();
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// Filtros de busca na tabela com debounce
function debounceFilterTickets() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    loadAdminTickets();
  }, 300);
}

function filterAdminTickets() {
  loadAdminTickets();
}

// Atalhos de quantidade de números no modal
function setNumbersShortcut(qty) {
  document.getElementById('newCampTotalNumbers').value = qty;
}

// Abrir Modal de Nova Campanha
function openNewCampaignModal() {
  document.getElementById('newCampaignForm').reset();
  document.getElementById('newCampTotalNumbers').value = 100;
  openModal('newCampaignModal');
}

// Criar Nova Campanha (REQUISITO CRÍTICO: CONFIGURAÇÃO DE QUANTIDADE DE NÚMEROS!)
async function handleCreateCampaign(e) {
  e.preventDefault();

  const title = document.getElementById('newCampTitle').value.trim();
  const prize = document.getElementById('newCampPrize').value.trim();
  const totalNumbers = parseInt(document.getElementById('newCampTotalNumbers').value, 10);
  const description = document.getElementById('newCampDesc').value.trim();
  const drawDate = document.getElementById('newCampDrawDate').value.trim();
  const imageUrl = document.getElementById('newCampImage').value.trim();

  if (isNaN(totalNumbers) || totalNumbers < 1 || totalNumbers > 100000) {
    alert('Informe uma quantidade de números válida (entre 1 e 100.000).');
    return;
  }

  const btn = document.getElementById('btnSubmitNewCamp');
  btn.disabled = true;
  btn.textContent = `Gerando campanha com ${totalNumbers} números...`;

  try {
    const res = await fetch('/api/admin/campaigns', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        title,
        prize,
        total_numbers: totalNumbers,
        description,
        draw_date: drawDate,
        image_url: imageUrl
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao criar campanha.');

    closeModal('newCampaignModal');
    alert(`Sucesso! A campanha "${title}" foi criada com ${totalNumbers} números gerados.`);
    await loadAdminCampaigns();
  } catch (err) {
    alert('Falha ao criar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar Campanha e Gerar Bilhetes';
  }
}

// Excluir Campanha Atual
async function deleteCurrentCampaign() {
  if (!currentAdminCampaign) return;

  const confirm1 = confirm(`ATENÇÃO: Deseja realmente excluir a campanha "${currentAdminCampaign.title}" e todos os seus bilhetes?`);
  if (!confirm1) return;

  try {
    const res = await fetch(`/api/admin/campaigns/${currentAdminCampaign.id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao excluir.');

    alert('Campanha excluída com sucesso.');
    currentAdminCampaign = null;
    await loadAdminCampaigns();
  } catch (err) {
    alert('Erro ao excluir: ' + err.message);
  }
}

// Abrir Modal de Sorteio
function openDrawModal() {
  if (!currentAdminCampaign) return;
  document.getElementById('rouletteDisplay').textContent = '---';
  document.getElementById('winnerResultBox').classList.add('hidden');
  document.getElementById('btnSpinDraw').disabled = false;
  openModal('drawModal');
}

// Executar Sorteio com Efeito Roleta
async function executeDraw() {
  if (!currentAdminCampaign) return;

  const btn = document.getElementById('btnSpinDraw');
  const display = document.getElementById('rouletteDisplay');
  const resultBox = document.getElementById('winnerResultBox');

  btn.disabled = true;
  resultBox.classList.add('hidden');

  try {
    const res = await fetch(`/api/admin/campaigns/${currentAdminCampaign.id}/draw`, {
      method: 'POST',
      headers: getAuthHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro no sorteio.');

    // Efeito visual de roleta girando
    let speed = 40;
    let count = 0;
    const maxRotations = 35;
    const totalNums = currentAdminCampaign.total_numbers;

    const interval = setInterval(() => {
      count++;
      const fakeNumber = Math.floor(Math.random() * totalNums) + 1;
      display.textContent = formatNumber(fakeNumber, totalNums);

      if (count > maxRotations) {
        clearInterval(interval);
        // Exibe o vencedor definitivo
        const winner = data.winner;
        display.textContent = formatNumber(winner.number, totalNums);
        display.classList.add('text-emerald-600');

        document.getElementById('winNumberText').textContent = `#${formatNumber(winner.number, totalNums)}`;
        document.getElementById('winNameText').textContent = winner.buyer_name || 'Não informado';
        document.getElementById('winPhoneText').textContent = winner.buyer_phone || 'Não informado';
        document.getElementById('winAddressText').textContent = winner.buyer_address || 'Não informado';

        resultBox.classList.remove('hidden');
        btn.disabled = false;

        // Atualiza a campanha
        loadAdminCampaigns();
      }
    }, speed);

  } catch (err) {
    alert('Não foi possível realizar o sorteio: ' + err.message);
    btn.disabled = false;
    display.textContent = '---';
  }
}

// Exportar Participantes para Planilha CSV
function exportParticipantsCSV() {
  if (!currentAdminCampaign || adminTickets.length === 0) {
    alert('Nenhum dado disponível para exportar.');
    return;
  }

  const total = currentAdminCampaign.total_numbers;
  let csvContent = '\uFEFF'; // BOM para garantir acentos corretos no Excel
  csvContent += 'Numero;Status;Nome_Comprador;Telefone_WhatsApp;Endereco_Entrega;Data_Reserva\n';

  adminTickets.forEach(t => {
    const num = formatNumber(t.number, total);
    const status = t.status !== 'available' ? 'Reservado' : 'Disponivel';
    const name = (t.buyer_name || '').replace(/;/g, ' ');
    const phone = (t.buyer_phone || '').replace(/;/g, ' ');
    const address = (t.buyer_address || '').replace(/;/g, ' ').replace(/\n/g, ' ');
    const resAt = t.reserved_at ? formatDateTime(t.reserved_at) : '';

    csvContent += `"${num}";"${status}";"${name}";"${phone}";"${address}";"${resAt}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `participantes_rifa_${currentAdminCampaign.id}_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Alterar Senha
function openChangePasswordModal() {
  document.getElementById('currentPass').value = '';
  document.getElementById('newPass').value = '';
  openModal('changePasswordModal');
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('currentPass').value;
  const newPassword = document.getElementById('newPass').value;

  try {
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao alterar senha.');

    alert('Senha alterada com sucesso!');
    closeModal('changePasswordModal');
  } catch (err) {
    alert('Erro: ' + err.message);
  }
}

// Auxiliares de modal
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}
