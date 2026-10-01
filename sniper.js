/* Sniper 1.3 — mundo automático nos mercados oficiais; sem envio de comandos. */
(function (root) {
  'use strict';
  const UNITS = [
    ['spear', 'Lanceiro', 18], ['sword', 'Espadachim', 22],
    ['axe', 'Bárbaro', 18], ['archer', 'Arqueiro', 18],
    ['spy', 'Explorador', 9], ['light', 'Cavalaria leve', 10],
    ['marcher', 'Arqueiro a cavalo', 10], ['heavy', 'Cavalaria pesada', 11],
    ['ram', 'Aríete', 30], ['catapult', 'Catapulta', 30],
    ['knight', 'Paladino', 10], ['snob', 'Nobre', 35], ['militia', 'Milícia', 0]
  ].map(([id, name, speed]) => ({ id, name, speed }));
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  function integer(value, name, max = 99999999) {
    const text = String(value);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > max)
      throw new Error(name + ': use um número inteiro entre 0 e ' + max + '.');
    return Number(text);
  }
  function coordinate(value) { return integer(value, 'Coordenada', 999); }
  // UTC is used only as an arithmetic container for SERVER wall-clock fields.
  // No conversion to the computer's local timezone is performed.
  function parseDate(value) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2}):(\d{3})$/.exec(value);
    if (!m) throw new Error('Chegada: use dd/mm/aaaa hh:MM:ss:mmm.');
    const [d, mo, y, h, mi, s, ms] = m.slice(1).map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
    if (y < 2000 || y > 2199 || date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 ||
        date.getUTCDate() !== d || h > 23 || mi > 59 || s > 59)
      throw new Error('Data ou horário inválido. Use o relógio do servidor.');
    return date.getTime();
  }
  function parseServerClock(date, time) {
    const text = date.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const normalized = iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : text.replace(/[.-]/g, '/');
    return parseDate(`${normalized} ${time.trim()}:000`);
  }
  function formatDate(value) {
    const d = new Date(value);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}:${pad(d.getUTCMilliseconds(), 3)}`;
  }
  function duration(value) {
    const seconds = Math.round(value / 1000);
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
  }
  function remaining(value) {
    if (!Number.isFinite(value) || value < 0) return 'N/A';
    const ms = Math.floor(value);
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}:${pad(ms % 1000, 3)}`;
  }
  function villageImage(points) {
    const index = points < 300 ? 0 : points < 1000 ? 1 : points < 3000 ? 2 : points < 9000 ? 3 : points < 11000 ? 4 : 5;
    return `https://dsbr.innogamescdn.com/asset/07afad24/graphic/map/icon/v${index + 1}_icon.webp`;
  }
  function sortPlans(plans, now) {
    return [...plans].sort((a, b) => {
      const aLate = a.departure < now, bLate = b.departure < now;
      if (aLate !== bLate) return aLate ? 1 : -1;
      return a.departure - b.departure || (a.row?.village.name || a.name || '').localeCompare(b.row?.village.name || b.name || '', 'pt-BR', { numeric: true, sensitivity: 'base' });
    });
  }
  function parseDuration(value) {
    const m = /^(\d{1,6}):([0-5]\d):([0-5]\d)$/.exec(value);
    if (!m) throw new Error('Duração conferida: use hhh:mm:ss.');
    const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (seconds <= 0) throw new Error('A duração precisa ser maior que zero.');
    return seconds * 1000;
  }
  function maskDate(value) {
    const digits = value.replace(/\D/g, '').slice(0, 17);
    const lengths = [2, 2, 4, 2, 2, 2, 3], separators = ['/', '/', ' ', ':', ':', ':'];
    let offset = 0, result = '';
    lengths.forEach((length, index) => {
      const part = digits.slice(offset, offset + length);
      if (part) result += (index ? separators[index - 1] : '') + part;
      offset += length;
    });
    return result;
  }
  function calculate({ origin, target, arrival, counts, units, worldSpeed, unitSpeed, sigil, percent, verifiedDuration }) {
    const dx = coordinate(origin.x) - coordinate(target.x);
    const dy = coordinate(origin.y) - coordinate(target.y);
    if (!dx && !dy) throw new Error('Origem e destino são a mesma aldeia.');
    if (sigil && ![10, 20, 30].includes(Number(percent))) throw new Error('Selecione 10%, 20% ou 30%.');
    const chosen = units.filter(u => integer(counts[u.id] ?? 0, u.name) > 0);
    if (!chosen.length) throw new Error('Selecione tropas e informe quantidades maiores que zero.');
    if (chosen.some(u => u.id === 'militia')) throw new Error('Milícia não pode ser enviada como apoio.');
    if (chosen.some(u => !Number.isFinite(u.speed) || u.speed <= 0)) throw new Error('Velocidade de tropa indisponível.');
    if (![worldSpeed, unitSpeed].every(n => Number.isFinite(n) && n > 0)) throw new Error('Velocidades do mundo inválidas.');
    if (chosen.some(u => u.id === 'knight') && !verifiedDuration)
      throw new Error('Cálculo com paladino ainda não disponível: seus efeitos de velocidade precisam ser validados.');
    const slowest = chosen.reduce((a, b) => a.speed >= b.speed ? a : b);
    const distance = Math.hypot(dx, dy);
    // Model assumption: bonus is a speed increase, not a percentage subtracted
    // from duration. This assumption and rounding must be compared with the game.
    const estimatedSeconds = distance * slowest.speed * 60 / (worldSpeed * unitSpeed) / (sigil ? 1 + Number(percent) / 100 : 1);
    const travel = verifiedDuration ? parseDuration(verifiedDuration) : Math.round(estimatedSeconds) * 1000;
    const at = parseDate(arrival);
    return { travel, departure: at - travel, arrival: at, distance, slowest: slowest.name, verified: !!verifiedDuration };
  }
  function parseVillages(text, owner) {
    const villages = [];
    for (const line of text.trim().split(/\r?\n/)) {
      const [id, encoded, x, y, player] = line.split(',');
      if (player !== String(owner)) continue;
      let name;
      try { name = decodeURIComponent(encoded.replace(/\+/g, ' ')); } catch { throw new Error('Nome inválido nos dados de aldeias.'); }
      villages.push({ id, name, x: coordinate(x), y: coordinate(y) });
    }
    return villages.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
  function publicTarget(villages, players, x, y) {
    const tx = coordinate(x), ty = coordinate(y);
    const line = villages.split(/\r?\n/).find(line => { const c = line.split(','); return c.length >= 6 && Number(c[2]) === tx && Number(c[3]) === ty; });
    if (!line) return null;
    const [id, encoded, , , ownerId, rawPoints] = line.split(',');
    const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
    const player = players.split(/\r?\n/).find(line => line.split(',')[0] === ownerId);
    return { id, name: decode(encoded), x: tx, y: ty, ownerId, owner: ownerId === '0' ? 'Bárbara' : player ? decode(player.split(',')[1]) : 'Proprietário não encontrado', points: integer(rawPoints, 'Pontos') };
  }
  function readRallyStocks(page, units) {
    if (!page.querySelector('#command-data-form')) throw new Error('Praça indisponível: confira login, proteção de acesso ou estrutura da página.');
    const troops = {};
    for (const u of units) {
      const text = page.getElementById('units_entry_all_' + u.id)?.textContent.trim();
      if (!text || !/^[\d\s.,()]+$/.test(text)) throw new Error('Estoque não reconhecido: ' + u.name + '.');
      troops[u.id] = integer(text.replace(/\D/g, ''), u.name);
    }
    return troops;
  }
  const api = { UNITS, integer, coordinate, parseDate, parseServerClock, formatDate, duration, remaining, sortPlans, villageImage, parseDuration, maskDate, calculate, parseVillages, publicTarget, readRallyStocks };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  if (!root.document) return;
  root.SupportPlanner = api;
  const doc = root.document;
  if ((!/^[a-z]{2,4}\d+\.(?:tribalwars\.(?:com\.br|com\.pt|co\.uk|net|com|us|nl|dk|se|ae|asia|works)|die-staemme\.de|staemme\.ch|plemiona\.pl|divokekmeny\.cz|divoke-kmene\.sk|guerretribale\.fr|guerrastribales\.es|tribals\.it|triburile\.ro|klanhaboru\.hu|klanlar\.org|fyletikesmaxes\.gr|vojnaplemen\.si|plemena\.com|voynaplemyon\.com)$/.test(location.hostname) || !root.game_data || String(root.game_data.world) !== location.hostname.split('.')[0])) {
    alert('Abra um mundo oficial do Tribal Wars com a conta autenticada.'); return;
  }
  const worldName = String(root.game_data.world).toUpperCase();
  const screen = root.game_data?.screen;
  if (screen !== 'place' && screen !== 'overview_villages') {
    alert('Abra a praça de reunião ou a visualização de comandos chegando.'); return;
  }
  const old = doc.getElementById('support-planner');
  if (old) { old.scrollIntoView(); return; }
  function el(tag, text, attrs = {}) {
    const n = doc.createElement(tag);
    if (text !== undefined) n.textContent = text;
    Object.entries(attrs).forEach(([key, value]) => n.setAttribute(key, value));
    return n;
  }
  const panel = el('section', undefined, { id: 'support-planner', 'aria-label': 'Sniper' });
  panel.append(el('style', `
    #support-planner{color:#000;margin:4px 0 16px;font:12px/1.25 Verdana,Arial,sans-serif;max-width:100%;box-sizing:border-box}
    #support-planner *{box-sizing:border-box}#support-planner h2{margin:0 0 14px;font:bold 19px Georgia,serif;color:#000}
    #support-planner .sp-toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:18px 0}
    #support-planner .sp-destination{align-self:flex-start}
    #support-planner .sp-target-card{align-self:flex-start;display:flex;align-items:center;gap:6px;position:relative;background:#fff5da;border:1px solid #9b7b45;padding:4px 22px 4px 4px;min-height:58px;width:300px;max-width:100%;color:#000}
    #support-planner .sp-target-card img{width:56px;height:40px;object-fit:contain;object-position:center;flex-shrink:0}
    #support-planner .sp-target-title{font-weight:bold;color:#603000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #support-planner .sp-target-meta{font-size:10px;white-space:normal;overflow-wrap:anywhere}
    #support-planner .sp-target-card button{position:absolute;right:3px;top:1px;background:none;border:0;box-shadow:none;color:#b00000;font:bold 20px Arial;padding:0 2px}
    #support-planner label{display:block}#support-planner .sp-label{font-weight:bold;display:block;margin-bottom:5px}
    #support-planner input:not([type=checkbox]),#support-planner select{background:#fff;color:#000;border:1px solid #a99876;border-radius:0;padding:3px;font:12px Verdana,Arial,sans-serif}
    #support-planner input[type=checkbox]{width:13px;height:13px;accent-color:#725323;vertical-align:middle;margin:3px}
    #support-planner button{cursor:pointer;border:1px solid #513510;border-radius:3px;background:linear-gradient(#ad8b50,#674115);box-shadow:inset 0 1px #d8bd80;color:white;padding:3px 6px;font:bold 12px Verdana,Arial,sans-serif}
    #support-planner button:disabled{opacity:.5;cursor:default}#support-planner input:disabled,#support-planner select:disabled{opacity:.45}
    #support-planner .sp-coordinate{width:44px}#support-planner .sp-date{width:211px;font-variant-numeric:tabular-nums}
    #support-planner .sp-scroll{overflow:auto;margin:5px 0 10px}
    #support-planner table{width:100%;border-collapse:separate;border-spacing:2px;background:#ecd8a5}#support-planner th,#support-planner td{border:0;padding:4px 3px;text-align:center;white-space:nowrap}
    #support-planner th{background:linear-gradient(#d6be86,#bd9e5b);font-weight:bold;color:#563000}#support-planner td{background:#f3e5bd;height:69px}#support-planner tbody tr:nth-child(even) td{background:#f0dfb1}#support-planner tbody tr.sp-selected td{background:#fff2cd}
    #support-planner th:first-child,#support-planner td:first-child{text-align:left;min-width:108px;max-width:130px;white-space:normal}#support-planner .sp-village{font-weight:bold;color:#603000;line-height:1.15}
    #support-planner .sp-unit{display:flex;align-items:center;gap:3px;flex-direction:column;min-width:40px}#support-planner .sp-unit img{width:18px;height:18px;object-fit:contain}
    #support-planner .sp-qty,#support-planner .sp-override{width:43px;padding:2px!important;font-size:11px!important;appearance:textfield}#support-planner input::-webkit-inner-spin-button{appearance:none}
    #support-planner .sp-stock{font-size:10px;color:#85672e;margin-top:3px}#support-planner .sp-zero{color:#b18a43}#support-planner [hidden]{display:none!important}
    #support-planner .sp-sigil{text-align:center}#support-planner .sp-result-troops{display:flex;flex-wrap:wrap;gap:8px;max-width:340px}#support-planner .sp-result-troops span{display:inline-flex;align-items:center;gap:3px}#support-planner .sp-result-troops img{width:18px;height:18px}
    #support-planner .sp-destination{border:1px solid #85622a;background:#f4e4bd;padding:7px 9px;box-shadow:1px 1px 3px #af925a}#support-planner .sp-selection{min-width:75px;white-space:normal}
    #support-planner .sp-results td{height:auto;padding:8px}#support-planner .sp-results th:first-child{min-width:140px}#support-planner .sp-results .sp-time{white-space:normal;min-width:215px}
    #support-planner .sp-note{font-size:11px;color:#67573e}#support-planner .sp-status{padding:6px 0;font-size:11px;color:#67573e}
    #support-planner .sp-error{color:#922a20}#support-planner .sp-time{font-variant-numeric:tabular-nums;font-weight:bold}
    #support-planner details{margin-top:12px}#support-planner summary{cursor:pointer}#support-planner .sp-duration{width:112px}
  `));
  panel.append(el('h2', 'Sniper'));
  const toolbar = el('div', undefined, { class: 'sp-toolbar' });
  function labeled(title, input) { const label = el('label'); label.append(el('span', title, { class: 'sp-label' }), input); return label; }
  const x = el('input', undefined, { class: 'sp-coordinate', inputmode: 'numeric', maxlength: '3', placeholder: 'X', 'aria-label': 'Coordenada X do destino' });
  const y = el('input', undefined, { class: 'sp-coordinate', inputmode: 'numeric', maxlength: '3', placeholder: 'Y', 'aria-label': 'Coordenada Y do destino' });
  const coords = el('div', undefined, { class: 'sp-destination' }); coords.append(el('span', 'Destino: coordenadas', { class: 'sp-label' }), x, doc.createTextNode(' | '), y);
  const targetCard = el('div', undefined, { class: 'sp-target-card', 'aria-label': 'Informações da aldeia alvo' });
  const targetImage = el('img', undefined, { alt: 'Aldeia alvo', hidden: '' });
  const targetInfo = el('div'), targetName = el('div', '', { class: 'sp-target-title' }), targetMeta = el('div', '', { class: 'sp-target-meta' });
  targetInfo.style.minWidth = '0'; targetInfo.append(targetName, targetMeta);
  const clearTarget = el('button', '×', { type: 'button', 'aria-label': 'Limpar destino' });
  targetCard.append(targetImage, targetInfo, clearTarget);
  let targetRequest = 0, targetKey = '', publicFiles = null, publicFilesAt = 0;
  function resetTargetCard() {
    targetRequest++; targetKey = ''; targetCard.removeAttribute('aria-busy');
    targetImage.hidden = true; targetName.textContent = 'Selecione a aldeia alvo'; targetName.title = '';
    targetMeta.textContent = 'Informe as coordenadas ao lado';
  }
  async function updateTargetCard() {
    if (!/^\d{1,3}$/.test(x.value) || !/^\d{1,3}$/.test(y.value)) { resetTargetCard(); return; }
    const key = `${Number(x.value)}|${Number(y.value)}`;
    if (key === targetKey) return;
    targetKey = key; const request = ++targetRequest;
    targetImage.hidden = true; targetName.textContent = `Consultando ${key}…`; targetName.title = '';
    targetMeta.textContent = 'Buscando dados públicos do ' + worldName; targetCard.setAttribute('aria-busy', 'true');
    try {
      let data;
      {
        if (!publicFiles || Date.now() - publicFilesAt > 300000) {
          publicFilesAt = Date.now();
          publicFiles = Promise.all([read('/map/village.txt'), read('/map/player.txt')]);
          publicFiles.catch(() => { publicFiles = null; });
        }
        const [villages, players] = await publicFiles;
        data = publicTarget(villages, players, x.value, y.value);
      }
      if (request !== targetRequest) return;
      if (!data) { targetName.textContent = `Nenhuma aldeia em ${key}`; targetMeta.textContent = 'Coordenadas não encontradas no mapa público.'; return; }
      targetName.textContent = `${data.name} (${pad(data.x,3)}|${pad(data.y,3)})`;
      targetName.title = targetName.textContent;
      targetMeta.textContent = `Proprietário: ${data.owner}  Pontos: ${Number(data.points).toLocaleString('pt-BR')}`;
      targetImage.src = villageImage(data.points); targetImage.alt = `Aldeia com ${data.points} pontos`; targetImage.hidden = false;
    } catch {
      if (request !== targetRequest) return;
      targetKey = ''; targetName.textContent = 'Não foi possível consultar';
      targetMeta.textContent = 'Verifique a conexão e tente novamente.';
    } finally { if (request === targetRequest) targetCard.removeAttribute('aria-busy'); }
  }
  x.addEventListener('input', () => {
    x.value = x.value.replace(/\D/g, '').slice(0,3); resetTargetCard();
    if (x.value.length === 3) { y.focus(); y.select(); if (y.value.length === 3) updateTargetCard(); }
  });
  y.addEventListener('input', () => {
    y.value = y.value.replace(/\D/g, '').slice(0,3); resetTargetCard();
    if (y.value.length === 3) updateTargetCard();
  });
  y.addEventListener('blur', updateTargetCard);
  clearTarget.addEventListener('click', () => { x.value = ''; y.value = ''; x.dispatchEvent(new Event('input', { bubbles: true })); y.dispatchEvent(new Event('input', { bubbles: true })); x.focus(); });
  const arrival = el('input', undefined, { class: 'sp-date', maxlength: '23', inputmode: 'numeric', 'aria-label': 'Chegada no horário do servidor' });
  const arrivalFormat = 'dd/mm/aaaa hh:MM:ss:mmm';
  const arrivalField = el('span', undefined, {class:'sp-date-field'});
  arrivalField.style.cssText='display:inline-block;position:relative';
  arrival.style.cssText='font:12px Verdana,Arial,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:normal;margin:0;vertical-align:middle';
  const arrivalHint=el('span', undefined, {'aria-hidden':'true'});
  arrivalHint.style.cssText='position:absolute;left:4px;top:50%;transform:translateY(-50%);pointer-events:none;white-space:pre;font:12px Verdana,Arial,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:normal;color:#888';
  const enteredHint=el('span'), remainingHint=el('span',arrivalFormat);
  enteredHint.style.visibility='hidden';
  arrivalHint.append(enteredHint,remainingHint);arrivalField.append(arrival,arrivalHint);
  arrival.addEventListener('input', () => {
    arrival.value = maskDate(arrival.value);
    enteredHint.textContent=arrival.value;
    remainingHint.textContent=arrivalFormat.slice(arrival.value.length);
  });
  const sigil = el('input', undefined, { type: 'checkbox', 'aria-label': 'Sinal de Aflição ativo no destino' });
  const sigilLabel = el('div', undefined, { class: 'sp-sigil' });
  const percent = el('select', undefined, { 'aria-label': 'Percentual do Sinal de Aflição' });
  [10, 20, 30].forEach(n => percent.append(el('option', n + '%', { value: String(n) })));
  percent.disabled = true;
  sigil.addEventListener('change', () => { percent.disabled = !sigil.checked; });
  sigilLabel.append(el('span', 'Sinal da aflição', { class: 'sp-label' }), sigil, percent);
  const calc = el('button', 'Calcular', { type: 'button' });
  toolbar.append(coords, targetCard, labeled('Chegada - Horário alvo', arrivalField), sigilLabel, calc);
  panel.append(toolbar);
  const load = el('button', 'Carregar minhas aldeias', { type: 'button' });
  const status = el('p', 'Selecione aldeias e tropas para montar o plano.', { class: 'sp-status', role: 'status', 'aria-live': 'polite' });
  const scroll = el('div', undefined, { class: 'sp-scroll' });
  const table = el('table', undefined, { 'aria-label': 'Tropas por aldeia' }), head = el('thead'), body = el('tbody'); table.append(head, body); scroll.append(table); panel.append(scroll, status);
  const resultScroll = el('div', undefined, { class: 'sp-scroll' });
  const resultTable = el('table', undefined, { class: 'sp-results', 'aria-label': 'Horários dos apoios' });
  const resultHead = el('thead'), resultHeader = el('tr'), resultBody = el('tbody');
  ['Aldeia', 'Distância', 'Tropas', 'Tempo restante', ''].forEach(t => resultHeader.append(el('th', t, { scope: 'col' })));
  resultHead.append(resultHeader); resultTable.append(resultHead, resultBody); resultScroll.append(resultTable);
  resultScroll.hidden = true; toolbar.after(status, resultScroll);
  const clockLabel = el('p', '', { class: 'sp-note' }); toolbar.after(clockLabel);
  const details = el('details'); details.append(el('summary', 'Como os horários são calculados'));
  details.append(el('p', 'Considera a distância, a tropa mais lenta e as velocidades públicas do mundo. O Sinal de Aflição é tratado como aumento de velocidade: duração ÷ (1 + percentual/100). Essa interpretação e o arredondamento ao segundo ainda precisam ser comparados com a praça de reunião.'));
  details.append(el('p', 'Efeitos especiais de paladino e outros bônus de apoio ainda precisam ser validados. Formações com paladino não geram estimativas enquanto essa validação estiver pendente.'));
  details.append(el('p', 'Os milésimos digitados são preservados na subtração. Confira as durações e use o relógio do servidor para o envio manual.'));
  panel.append(details);
  (doc.getElementById('content_value') || doc.getElementById('planner-mount') || doc.body).prepend(panel);
  let units = UNITS.filter(u => u.id !== 'militia').map(u => ({ ...u })), worldSpeed = NaN, unitSpeed = NaN, rows = [], headers = {}, ready = false;
  let currentPage = 0, pageSize = 25;
  const pager = el('div', undefined, {class:'sp-pagination'});
  pager.style.cssText='display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 14px';
  const sizeInput = el('input', undefined, {type:'text',inputmode:'numeric','aria-label':'Aldeias por página',size:'4',maxlength:'5'});
  sizeInput.value='25';
  const previous=el('button','Anterior',{type:'button'}), next=el('button','Próxima',{type:'button'}), pageLabel=el('span','',{ 'aria-live':'polite'});
  const sizeLabel=el('label','Aldeias por página ');sizeLabel.append(sizeInput);
  load.style.marginLeft='auto';
  pager.append(sizeLabel,previous,next,pageLabel,load);scroll.after(pager);
  function updatePagination(){
    const total=Math.ceil(rows.length/pageSize);
    currentPage=Math.max(0,Math.min(currentPage,Math.max(0,total-1)));
    rows.forEach((row,index)=>{row.selected.closest('tr').hidden=index<currentPage*pageSize || index>=(currentPage+1)*pageSize;});
    previous.disabled=currentPage===0;next.disabled=!total||currentPage>=total-1;
    pageLabel.textContent=total ? 'Página '+(currentPage+1)+' de '+total+' · '+rows.length+' aldeias' : 'Nenhuma aldeia carregada';
  }
  sizeInput.addEventListener('input',()=>{
    if(!/^[1-9]\d*$/.test(sizeInput.value)){sizeInput.setCustomValidity('Informe um número inteiro maior que zero.');return;}
    sizeInput.setCustomValidity('');pageSize=Number(sizeInput.value);currentPage=0;updatePagination();
  });
  sizeInput.addEventListener('blur',()=>{if(!sizeInput.checkValidity()){sizeInput.value=String(pageSize);sizeInput.setCustomValidity('');}});
  previous.addEventListener('click',()=>{currentPage--;updatePagination();});
  next.addEventListener('click',()=>{currentPage++;updatePagination();});
  let plans = [], clockAnchor = null, clockText = '', clockSample = 0;
  function now() {

    const date = doc.getElementById('serverDate')?.textContent.trim(), time = doc.getElementById('serverTime')?.textContent.trim();
    if (!date || !time) return NaN;
    const stamp = `${date} ${time}`;
    if (stamp !== clockText) {
      try { clockAnchor = parseServerClock(date, time); clockSample = performance.now(); clockText = stamp; } catch { return NaN; }
    }
    const elapsed = performance.now() - clockSample;
    return elapsed > 3000 ? NaN : clockAnchor + elapsed;
  }
  function tick() {
    const current = now();
    clockLabel.textContent = Number.isFinite(current) ? `Horário do servidor: ${formatDate(current)}` : 'Relógio do servidor indisponível. Atualize a página antes de planejar.';
    for (const p of plans) { p.countdown.textContent = remaining(p.departure - current); p.send.disabled = !Number.isFinite(current) || p.departure < current; }
    if (Number.isFinite(current)) sortPlans(plans, current).forEach((p,i) => { if (resultBody.children[i] !== p.element) resultBody.insertBefore(p.element, resultBody.children[i] || null); });
  }
  const ticker = setInterval(() => { if (!panel.isConnected) clearInterval(ticker); else tick(); }, 50);
  root.addEventListener('pagehide', () => clearInterval(ticker), { once: true });
  function invalidate() {
    plans = []; resultBody.replaceChildren(); resultScroll.hidden = true;
    status.textContent = 'Plano alterado. Clique em Calcular.';
  }
  function clearDurations() { rows.forEach(r => { r.verified.value = ''; }); }
  for (const input of [x, y, sigil, percent]) input.addEventListener('input', () => { clearDurations(); invalidate(); });
  arrival.addEventListener('input', invalidate);
  function render(villages) {
    currentPage=0;
    head.replaceChildren(); body.replaceChildren(); resultBody.replaceChildren(); resultScroll.hidden = true; rows = []; headers = {};
    const hr = el('tr'), first = el('th', undefined, { scope: 'col' });
    const all = el('input', undefined, { type: 'checkbox', 'aria-label': 'Selecionar todas as aldeias' });
    first.textContent = 'Aldeia'; hr.append(first);
    for (const u of units) {
      const th = el('th', undefined, { scope: 'col' }), box = el('div', undefined, { class: 'sp-unit' });
      const check = el('input', undefined, { type: 'checkbox', 'aria-label': 'Incluir ' + u.name });
      const image = el('img', undefined, { src: 'https://dsbr.innogamescdn.com/graphic/unit/unit_' + u.id + '.png', alt: u.name, title: u.name });
      const quantity = el('input', undefined, { type: 'number', min: '0', max: '99999999', step: '1', class: 'sp-qty', 'aria-label': 'Quantidade padrão de ' + u.name });
      quantity.placeholder = '0';
      check.checked = false; quantity.disabled = true;
      check.addEventListener('change', () => { quantity.disabled = !check.checked; rows.forEach(r => r.refresh()); clearDurations(); invalidate(); });
      quantity.addEventListener('input', () => { rows.filter(r => r.selected.checked).forEach(r => { r.quantities[u.id].value = quantity.value === '' ? '' : String(Math.min(Number(quantity.value), r.village.troops?.[u.id] ?? Number(quantity.value))); }); clearDurations(); invalidate(); });
      headers[u.id] = { check, quantity };
      box.append(image, check, quantity); th.append(box); hr.append(th);
    }
    const selectHeader = el('th', undefined, { scope: 'col', class: 'sp-selection' });
    selectHeader.append(doc.createTextNode('Selecionar tudo'), el('br'), all); hr.append(selectHeader); head.append(hr);
    for (const village of villages) {
      const tr = el('tr'), cell = el('td'), selected = el('input', undefined, { type: 'checkbox', 'aria-label': 'Selecionar ' + village.name });
      cell.className = 'sp-village';
      cell.append(doc.createTextNode(village.name), el('br'), doc.createTextNode(`(${pad(village.x, 3)}|${pad(village.y, 3)}) K${Math.floor(village.y / 100)}${Math.floor(village.x / 100)}`));
      tr.append(cell);
      const quantities = {}, displays = {}, stocks = {};
      for (const u of units) {
        const td = el('td'), q = el('input', undefined, { type: 'number', min: '0', max: '99999999', step: '1', placeholder: '0', class: 'sp-override', 'aria-label': u.name + ' em ' + village.name });
        q.hidden = true;
        const available = village.troops?.[u.id];
        if (available !== undefined) q.max = String(available);
        const display = el('span', available === undefined ? '—' : String(available), { class: available === 0 ? 'sp-zero' : '' });
        const stock = el('div', available === undefined ? '' : '/ ' + available, { class: 'sp-stock' }); stock.hidden = true;
        q.addEventListener('input', () => { row.verified.value = ''; invalidate(); });
        quantities[u.id] = q; displays[u.id] = display; stocks[u.id] = stock; td.append(display, q, stock); tr.append(td);
      }
      const verified = el('input', undefined, { class: 'sp-duration', placeholder: 'hhh:mm:ss', 'aria-label': 'Duração total conferida para ' + village.name });
      const selectionCell = el('td'); selectionCell.append(selected); tr.append(selectionCell); body.append(tr);
      const row = { village, selected, quantities, verified, initialized: false, refresh() {
        tr.classList.toggle('sp-selected', selected.checked);
        if (selected.checked && !this.initialized) { units.forEach(u => { quantities[u.id].value = String(village.troops?.[u.id] ?? 0); }); this.initialized = true; }
        for (const u of units) {
          const q = quantities[u.id], active = selected.checked && headers[u.id].check.checked;
          q.hidden = !active; q.disabled = !active; displays[u.id].hidden = active; stocks[u.id].hidden = !active;
          q.placeholder = '0';
        }
      }}; rows.push(row); row.refresh();
      selected.addEventListener('change', () => { if (selected.checked) row.initialized = false; row.refresh(); all.checked = rows.every(r => r.selected.checked); all.indeterminate = !all.checked && rows.some(r => r.selected.checked); invalidate(); });
      verified.addEventListener('input', invalidate);
    }
    all.addEventListener('change', () => { rows.forEach(r => { r.selected.checked = all.checked; if (all.checked) r.initialized = false; r.refresh(); }); all.indeterminate = false; invalidate(); });
    updatePagination();
    if (!villages.length) { const tr = el('tr'); tr.append(el('td', 'Carregue suas aldeias para selecionar as origens.', { colspan: String(units.length + 3) })); body.append(tr); }
  }
  async function read(path) {
    const response = await fetch(path, { method: 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Falha ao consultar dados públicos do mundo.');
    return response.text();
  }
  function xml(text) {
    const parsed = new DOMParser().parseFromString(text, 'text/xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.tagName !== 'config') throw new Error('Configuração pública inválida.');
    return parsed;
  }
  function rallyURL(villageId) {
    const url = new URL('/game.php', location.origin);
    url.searchParams.set('village', villageId); url.searchParams.set('screen', 'place');
    const sitter = new URLSearchParams(location.search).get('t');
    if (sitter) url.searchParams.set('t', sitter);
    return url;
  }
  load.addEventListener('click', async () => {
    load.disabled = true; calc.disabled = true; ready = false;
    invalidate();
    try {
      {
        status.textContent = `Consultando configurações e mapa público do ${worldName}…`;
        const [configText, unitText, villageText] = await Promise.all([
          read('/interface.php?func=get_config'), read('/interface.php?func=get_unit_info'), read('/map/village.txt')
        ]);
        const config = xml(configText), info = xml(unitText);
        worldSpeed = Number(config.querySelector('config > speed')?.textContent);
        unitSpeed = Number(config.querySelector('config > unit_speed')?.textContent);
        if (![worldSpeed, unitSpeed].every(n => Number.isFinite(n) && n > 0)) throw new Error('Velocidades públicas inválidas.');
        const enabledUnits = Array.isArray(root.game_data.units) ? root.game_data.units : null;
        const archersEnabled = config.querySelector('game > archer')?.textContent.trim();
        units = UNITS.filter(u => u.id !== 'militia' && info.querySelector(u.id) && (!enabledUnits || enabledUnits.includes(u.id)) && (archersEnabled !== '0' || !['archer', 'marcher'].includes(u.id))).map(u => ({ ...u, speed: Number(info.querySelector(u.id + ' > speed')?.textContent) }));
        if (!units.length) throw new Error('Nenhuma unidade encontrada.');
        if (units.some(u => !Number.isFinite(u.speed) || u.speed <= 0)) throw new Error('Velocidade de unidade inválida nas configurações do mundo.');
        const villages = parseVillages(villageText, root.game_data.player.id);
        if (!villages.length) throw new Error('Nenhuma aldeia sua encontrada no mapa público. Ele pode estar desatualizado.');
        // Read only normal rally pages accessible in the current authenticated session.
        // Never execute scripts from fetched HTML, submit forms or guess missing stock.
        for (let i = 0; i < villages.length; i++) {
          const village = villages[i];
          status.textContent = `Lendo tropas: ${i + 1}/${villages.length} — ${village.name}`;
          const response = await fetch(rallyURL(village.id), { credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
          if (!response.ok || new URL(response.url).origin !== location.origin) throw new Error('Falha ao abrir a praça. Atualize sua sessão.');
          const page = new DOMParser().parseFromString(await response.text(), 'text/html');
          const villageLink = page.querySelector('#menu_row2_village a');
          const identity = villageLink && new URL(villageLink.getAttribute('href'), location.origin);
          if (identity?.searchParams.get('village') !== String(village.id)) throw new Error('Não foi possível confirmar a aldeia da praça. Coleta interrompida.');
          village.troops = readRallyStocks(page, units);
          village.name = villageLink.textContent.trim() || village.name;
          if (i + 1 < villages.length) await new Promise(resolve => setTimeout(resolve, 500));
        }
        render(villages); ready = true;
        const expected = Number(root.game_data.player.villages);
        status.textContent = `${villages.length} aldeias com tropas consultadas nesta sessão. ` + (Number.isFinite(expected) && expected !== villages.length ? `O jogo informa ${expected}; a lista pública está incompleta ou desatualizada. ` : '') + 'Selecione aldeias e tropas e clique em Calcular. Atualize a coleta após movimentar tropas.';
      }
    } catch (error) { status.textContent = error.message; }
    finally { load.disabled = false; calc.disabled = !ready; }
  });
  function openRally(p) {
    if (!Number.isFinite(now()) || p.departure < now() || !plans.includes(p)) return;
    const url = new URL('/game.php', location.origin);
    url.searchParams.set('village', p.row.village.id); url.searchParams.set('screen', 'place');
    const sitter = new URLSearchParams(location.search).get('t'); if (sitter) url.searchParams.set('t', sitter);
    const tab = root.open(url.href, '_blank');
    if (!tab) { status.textContent = 'O navegador bloqueou a aba. Permita pop-ups para abrir a praça.'; return; }
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 80 || tab.closed) { clearInterval(timer); status.textContent = 'Não foi possível preencher a praça. Confira a nova aba e preencha manualmente.'; return; }
      try {
        if (tab.location.pathname !== '/game.php' || tab.document.readyState !== 'complete') return;
        if (new URLSearchParams(tab.location.search).get('village') !== String(p.row.village.id)) return;
        const form = tab.document.querySelector('#command-data-form');
        if (!form) return;
        const targetInput = form.querySelector('input[name="input"]');
        const tx = form.querySelector('input[name="x"]'), ty = form.querySelector('input[name="y"]');
        if (!targetInput && !(tx && ty)) return;
        const assignments = [];
        if (targetInput) assignments.push([targetInput, `${p.target.x}|${p.target.y}`]);
        if (tx && ty) assignments.push([tx, p.target.x], [ty, p.target.y]);
        for (const u of units) {
          const input = form.querySelector(`input[name="${u.id}"]`);
          if (!input && p.counts[u.id] > 0) return;
          if (input) assignments.push([input, p.counts[u.id] || 0]);
        }
        assignments.forEach(([input, value]) => { input.value = String(value); input.dispatchEvent(new tab.Event('input', { bubbles: true })); input.dispatchEvent(new tab.Event('change', { bubbles: true })); });
        clearInterval(timer); status.textContent = 'Praça preenchida. Confira os dados e escolha Apoio ou Ataque manualmente; o plano calculado considera apoio.';
      } catch { clearInterval(timer); status.textContent = 'A praça foi aberta, mas não pôde ser preenchida. Confira os dados manualmente.'; }
    }, 250);
  }
  calc.addEventListener('click', () => {
    if (!ready) { status.textContent = 'Carregue suas aldeias primeiro.'; return; }
    invalidate();
    try { parseDate(arrival.value); coordinate(x.value); coordinate(y.value); }
    catch (error) { status.textContent = error.message; return; }
    let success = 0, failed = 0;
    for (const row of rows) {
      if (!row.selected.checked) continue;
      try {
        const counts = {};
        units.forEach(u => {
          if (!headers[u.id].check.checked) { counts[u.id] = 0; return; }
          const available = row.village.troops?.[u.id], override = row.quantities[u.id].value;
          const amount = override === '' ? 0 : integer(override, u.name);
          if (available !== undefined && amount > available) throw new Error(`${u.name}: quantidade maior que as ${available} disponíveis.`);
          counts[u.id] = amount;
        });
        const plan = calculate({ origin: row.village, target: { x: x.value, y: y.value }, arrival: arrival.value, counts, units, worldSpeed, unitSpeed, sigil: sigil.checked, percent: Number(percent.value), verifiedDuration: row.verified.value.trim() });
        const tr = el('tr'), formation = el('div', undefined, { class: 'sp-result-troops' });
        units.filter(u => counts[u.id] > 0).forEach(u => {
          const item = el('span', undefined, { title: `${u.name}: ${counts[u.id]}` });
          item.append(el('img', undefined, { src: `https://dsbr.innogamescdn.com/graphic/unit/unit_${u.id}.png`, alt: u.name }), doc.createTextNode(String(counts[u.id]))); formation.append(item);
        });
        const formationCell = el('td'); formationCell.append(formation);
        const timeCell = el('td', undefined, { class: 'sp-time' }), countdown = el('div', '—');
        timeCell.append(countdown, el('div', 'Saída: ' + formatDate(plan.departure), { class: 'sp-note' }), el('div', 'Viagem: ' + duration(plan.travel), { class: 'sp-note' }));
        const send = el('button', 'Enviar', { type: 'button', title: 'Abrir a praça e preencher; confirmação manual' }), action = el('td'); action.append(send);
        tr.append(el('td', `${row.village.name} (${row.village.x}|${row.village.y})`), el('td', plan.distance.toFixed(2)), formationCell, timeCell, action);
        const p = { ...plan, element: tr, row, counts: { ...counts }, target: { x: x.value, y: y.value }, countdown, send };
        send.addEventListener('click', () => openRally(p)); plans.push(p); resultBody.append(tr);
        success++;
      } catch (error) { const tr = el('tr'); tr.append(el('td', row.village.name), el('td', error.message, { colspan: '4', class: 'sp-error' })); resultBody.append(tr); failed++; }
    }
    resultScroll.hidden = !(success || failed); tick();
    status.textContent = success || failed ? `${success} horários calculados; ${failed} linhas precisam de correção. Use o horário do servidor. Nenhum comando foi enviado.` : 'Selecione pelo menos uma aldeia.';
  });
  render([]);
  calc.disabled = !ready;

  tick();
  updateTargetCard();
})(typeof window !== 'undefined' ? window : globalThis);

