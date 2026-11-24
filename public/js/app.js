// Lógica do Frontend Público da Rifa
let currentCampaign = null;
let allCampaigns = [];
let allTickets = [];
let selectedNumbers = new Set();
let currentFilter = 'all';
let searchQuery = '';

document.addEventListener('DOMContentLoaded', () => {
  setupPhoneMask();
  loadCampaigns();

  // Busca rápida de número
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderGrid();
    });
  }

  // Seletor de campanhas
  const campSelect = document.getElementById('campaignSelect');
  if (campSelect) {
    campSelect.addEventListener('change', (e) => {
      const selectedId = parseInt(e.target.value, 10);
      const found = allCampaigns.find(c => c.id === selectedId);
      if (found) {
        selectCampaign(found);
      }
    });
  }
});

// Máscara automática de telefone celular brasileiro (XX) XXXXX-XXXX
function setupPhoneMask() {
  const phoneInput = document.getElementById('buyerPhone');
  if (!phoneInput) return;

  phoneInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);

    if (value.length > 10) {
      // Formato celular: (11) 98765-4321
      value = value.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    } else if (value.length > 6) {
      // Formato parcial: (11) 9876-5432
      value = value.replace(/^(\d{2})(\d{4,5})(\d{0,4})$/, '($1) $2-$3');
    } else if (value.length > 2) {
      value = value.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
    }
    e.target.value = value;
  });
}

// Carregar campanhas do servidor
async function loadCampaigns() {
  try {
    const res = await fetch('/api/campaigns');
    allCampaigns = await res.json();

    if (!allCampaigns || allCampaigns.length === 0) {
      document.getElementById('loadingGrid').innerHTML = `
        <div class="p-8 text-center text-slate-500 font-medium">
          Nenhuma campanha de rifa cadastrada no momento.<br>
          <a href="/admin" class="text-indigo-600 font-bold underline mt-2 inline-block">Acesse o painel do administrador</a> para criar a primeira rifa.
        </div>
      `;
      return;
    }

    // Configurar seletor caso haja mais de uma campanha
    const selectorContainer = document.getElementById('campaignSelectorContainer');
    const campSelect = document.getElementById('campaignSelect');

    if (allCampaigns.length > 1) {
      selectorContainer.classList.remove('hidden');
      campSelect.innerHTML = allCampaigns.map(c => `
        <option value="${c.id}">${c.title} (${c.total_numbers} números)</option>
      `).join('');
    } else {
      selectorContainer.classList.add('hidden');
    }

    // Seleciona a primeira campanha ativa (ou a primeira existente)
    const activeCamp = allCampaigns.find(c => c.status === 'active') || allCampaigns[0];
    selectCampaign(activeCamp);
  } catch (err) {
    console.error('Erro ao carregar campanhas:', err);
    document.getElementById('loadingGrid').innerHTML = `
      <div class="p-8 text-center text-rose-500 font-bold">
        Não foi possível carregar as campanhas. Verifique sua conexão com o servidor.
      </div>
    `;
  }
}

// Selecionar e exibir uma campanha
function selectCampaign(camp) {
  currentCampaign = camp;
  selectedNumbers.clear();
  updateFloatingBar();

  // Atualiza dados na tela
  document.getElementById('campTitle').textContent = camp.title;
  document.getElementById('campDesc').textContent = camp.description || 'Escolha seus números da sorte e participe!';
  document.getElementById('campNumbersCount').textContent = `${camp.total_numbers} Números`;
  const countCard = document.getElementById('campNumbersCountCard');
  if (countCard) countCard.textContent = `${camp.total_numbers} Números`;
  document.getElementById('campDrawDate').textContent = camp.draw_date || 'A definir';
  document.getElementById('campAvailableCount').textContent = camp.available_count ?? 0;

  // Imagem
  const imgEl = document.getElementById('campImage');
  imgEl.src = camp.image_url || 'https://images.unsplash.com/photo-1593359677879-a4bb92f829d1?auto=format&fit=crop&w=800&q=80';

  // Status Badge
  const badgeEl = document.getElementById('campStatusBadge');
  const winnerBanner = document.getElementById('winnerBanner');

  if (camp.status === 'finished') {
    badgeEl.textContent = 'Finalizada';
    badgeEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-700 text-white shadow-md';
    if (camp.winner_number) {
      winnerBanner.classList.remove('hidden');
      document.getElementById('winnerText').textContent = `Nº ${formatNumber(camp.winner_number, camp.total_numbers)}`;
    }
  } else if (camp.status === 'paused') {
    badgeEl.textContent = 'Pausada';
    badgeEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500 text-white shadow-md';
    winnerBanner.classList.add('hidden');
  } else {
    badgeEl.textContent = 'Ativa';
    badgeEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500 text-white shadow-md';
    winnerBanner.classList.add('hidden');
  }

  // Progresso de reservas
  updateProgressBar(camp);

  // Carrega os bilhetes
  loadTickets(camp.id);
}

// Atualizar a barra de progresso
function updateProgressBar(camp) {
  const total = camp.total_numbers || 1;
  const reserved = camp.reserved_count || 0;
  const reservedPct = Math.min(100, Math.round((reserved / total) * 100));

  const bar = document.getElementById('barReserved');
  if (bar) bar.style.width = `${reservedPct}%`;

  const progText = document.getElementById('campProgressText');
  if (progText) progText.textContent = `${reservedPct}% marcado (${reserved} de ${total} reservados)`;
}

// Carregar bilhetes da campanha (Rota 100% sigilosa)
async function loadTickets(campaignId) {
  const loading = document.getElementById('loadingGrid');
  const grid = document.getElementById('ticketsGrid');

  loading.classList.remove('hidden');
  grid.classList.add('hidden');

  try {
    const res = await fetch(`/api/campaigns/${campaignId}/numbers`);
    allTickets = await res.json();
    loading.classList.add('hidden');
    grid.classList.remove('hidden');
    renderGrid();
  } catch (err) {
    console.error('Erro ao buscar números:', err);
    loading.innerHTML = '<p class="text-sm text-rose-500 font-bold">Erro ao carregar números da campanha.</p>';
  }
}

// Formatar número com zeros à esquerda com base no total de números da campanha
function formatNumber(num, total) {
  if (total <= 100) {
    return String(num).padStart(2, '0');
  } else if (total <= 1000) {
    return String(num).padStart(3, '0');
  } else {
    return String(num).padStart(4, '0');
  }
}

// Renderizar o Grid de Bilhetes
function renderGrid() {
  const grid = document.getElementById('ticketsGrid');
  if (!grid || !currentCampaign) return;

  const total = currentCampaign.total_numbers;
  const winnerNum = currentCampaign.winner_number;

  // Filtragem
  const filteredTickets = allTickets.filter(t => {
    // Filtro de status
    if (currentFilter === 'available' && t.status !== 'available') return false;
    if (currentFilter === 'selected' && !selectedNumbers.has(t.number)) return false;

    // Filtro de busca textual
    if (searchQuery) {
      const numStr = String(t.number);
      const formatted = formatNumber(t.number, total);
      if (!numStr.includes(searchQuery) && !formatted.includes(searchQuery)) {
        return false;
      }
    }

    return true;
  });

  if (filteredTickets.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-500 font-medium">
        Nenhum número encontrado para o filtro selecionado.
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredTickets.map(t => {
    const formatted = formatNumber(t.number, total);
    const isSelected = selectedNumbers.has(t.number);
    const isWinner = winnerNum === t.number;

    let statusClass = t.status;
    let label = formatted;
    let title = `Número ${formatted} - Disponível`;

    if (isWinner) {
      statusClass = 'winner';
      title = `🏆 NÚMERO GANHADOR: ${formatted}`;
    } else if (isSelected) {
      statusClass = 'selected';
      title = `Número ${formatted} - Selecionado por você`;
    } else if (t.status === 'reserved') {
      title = `Número ${formatted} - Reservado (Aguardando pagamento)`;
    } else if (t.status === 'paid') {
      title = `Número ${formatted} - Pago / Indisponível`;
    }

    return `
      <div 
        class="ticket-box ${statusClass}" 
        data-number="${t.number}"
        data-status="${t.status}"
        title="${title}"
        onclick="toggleNumberSelection(${t.number}, '${t.status}')"
      >
        <span>${label}</span>
      </div>
    `;
  }).join('');
}

// Alternar seleção do número ao clicar
function toggleNumberSelection(number, status) {
  if (currentCampaign.status !== 'active') {
    alert('Esta campanha não está aberta para novas compras no momento.');
    return;
  }

  if (status !== 'available') {
    // Apenas informa que o número já está ocupado, mantendo sigilo total sobre o comprador!
    alert(`O número ${formatNumber(number, currentCampaign.total_numbers)} já está ${status === 'paid' ? 'pago' : 'reservado'} por outro participante.`);
    return;
  }

  if (selectedNumbers.has(number)) {
    selectedNumbers.delete(number);
  } else {
    selectedNumbers.add(number);
  }

  renderGrid();
  updateFloatingBar();
}

// Seleção Rápida de Números da Sorte
function selectRandomNumbers(qty) {
  if (!currentCampaign || currentCampaign.status !== 'active') {
    alert('Esta campanha não está ativa para compras.');
    return;
  }

  const availableTickets = allTickets.filter(t => t.status === 'available' && !selectedNumbers.has(t.number));
  if (availableTickets.length === 0) {
    alert('Não há mais números disponíveis nesta rifa.');
    return;
  }

  // Embaralha e pega a quantidade
  const shuffled = [...availableTickets].sort(() => 0.5 - Math.random());
  const toSelect = shuffled.slice(0, qty);

  toSelect.forEach(t => selectedNumbers.add(t.number));

  renderGrid();
  updateFloatingBar();
}

// Limpar Seleção
function clearSelection() {
  selectedNumbers.clear();
  renderGrid();
  updateFloatingBar();
}

// Definir Filtros Rápidos
function setFilter(filter) {
  currentFilter = filter;

  ['all', 'available', 'selected'].forEach(f => {
    const btn = document.getElementById('filter' + f.charAt(0).toUpperCase() + f.slice(1));
    if (btn) {
      if (f === filter) {
        btn.className = 'px-2.5 py-1 rounded-md bg-white text-slate-800 shadow-sm font-bold';
      } else {
        btn.className = 'px-2.5 py-1 rounded-md text-slate-600 hover:text-slate-900';
      }
    }
  });

  renderGrid();
}

// Atualizar Barra Fixa Inferior
function updateFloatingBar() {
  const bar = document.getElementById('floatingBar');
  const count = selectedNumbers.size;

  if (count === 0) {
    bar.classList.remove('active');
    return;
  }

  bar.classList.add('active');
  document.getElementById('floatCountText').textContent = `${count} número${count > 1 ? 's' : ''} selecionado${count > 1 ? 's' : ''}`;

  // Exibe chips dos números selecionados
  const sorted = Array.from(selectedNumbers).sort((a, b) => a - b);
  const chipsHtml = sorted.map(num => `
    <span class="inline-flex items-center px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[11px] font-bold">
      ${formatNumber(num, currentCampaign.total_numbers)}
    </span>
  `).join('');

  document.getElementById('floatSelectedChips').innerHTML = chipsHtml;
}

// Abrir Modal de Identificação / Reserva
function openReservationModal() {
  if (selectedNumbers.size === 0) {
    alert('Selecione pelo menos um número antes de continuar.');
    return;
  }

  const sorted = Array.from(selectedNumbers).sort((a, b) => a - b);
  const formattedNumbers = sorted.map(n => formatNumber(n, currentCampaign.total_numbers)).join(', ');

  document.getElementById('modalNumbersList').textContent = formattedNumbers;
  openModal('reservationModal');
}

// Enviar Reserva
async function handleReservationSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('buyerName').value.trim();
  const phone = document.getElementById('buyerPhone').value.trim();
  const address = document.getElementById('buyerAddress').value.trim();

  if (!name || name.length < 3) {
    alert('Por favor, informe seu nome completo.');
    return;
  }

  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    alert('Por favor, informe um WhatsApp/Telefone válido com DDD.');
    return;
  }

  if (!address || address.length < 5) {
    alert('Por favor, informe seu endereço completo.');
    return;
  }

  const btn = document.getElementById('btnConfirmReservation');
  btn.disabled = true;
  btn.innerHTML = `
    <div class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
    <span>Gravando escolha...</span>
  `;

  try {
    const res = await fetch(`/api/campaigns/${currentCampaign.id}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numbers: Array.from(selectedNumbers),
        name,
        phone,
        address
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Erro ao realizar reserva.');
    }

    closeModal('reservationModal');

    // Abre o Modal de Sucesso
    showSuccessModal(data, name);

    // Limpa seleção e recarrega os números para atualizar os estados na tela
    selectedNumbers.clear();
    updateFloatingBar();
    await loadCampaigns();
  } catch (err) {
    alert('Falha na reserva: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <span>Confirmar Escolha de Números</span>
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
    `;
  }
}

// Exibir Modal de Confirmação de Sucesso
function showSuccessModal(data, buyerName) {
  const formattedNumbers = data.reserved_numbers.map(n => formatNumber(n, currentCampaign.total_numbers)).join(', ');

  document.getElementById('pixReservedNumbers').textContent = formattedNumbers;
  const confirmBuyer = document.getElementById('confirmBuyerText');
  if (confirmBuyer) confirmBuyer.innerHTML = `Registrado para: <strong>${buyerName}</strong>`;

  openModal('paymentModal');
}

// Auxiliares de Modal
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}
