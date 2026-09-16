// Helper function to determine if two games refer to the same event
export const isSameGame = (a, b) => {
  if (!a || !b || a.league !== b.league) return false;
  if (a.eventId && b.eventId && String(a.eventId) === String(b.eventId)) return true;

  const norm = (s) => String(s || 'TBA').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const aAwayId = norm(a.awayId);
  const aHomeId = norm(a.homeId);
  const bAwayId = norm(b.awayId);
  const bHomeId = norm(b.homeId);

  if (aAwayId !== 'TBA' && aHomeId !== 'TBA' && bAwayId !== 'TBA' && bHomeId !== 'TBA') {
      const aArr = [aAwayId, aHomeId].sort();
      const bArr = [bAwayId, bHomeId].sort();
      if (aArr[0] === bArr[0] && aArr[1] === bArr[1]) return true;
  }

  const aAwayAbbr = norm(a.awayAbbr);
  const aHomeAbbr = norm(a.homeAbbr);
  const bAwayAbbr = norm(b.awayAbbr);
  const bHomeAbbr = norm(b.homeAbbr);

  if (aAwayAbbr !== 'TBA' && aHomeAbbr !== 'TBA' && bAwayAbbr !== 'TBA' && bHomeAbbr !== 'TBA') {
      const aArr = [aAwayAbbr, aHomeAbbr].sort();
      const bArr = [bAwayAbbr, bHomeAbbr].sort();
      if (aArr[0] === bArr[0] && aArr[1] === bArr[1]) return true;
  }

  const aAwayName = norm(a.awayName);
  const aHomeName = norm(a.homeName);
  const bAwayName = norm(b.awayName);
  const bHomeName = norm(b.homeName);
  
  if (aAwayName !== 'TBA' && aHomeName !== 'TBA' && bAwayName !== 'TBA' && bHomeName !== 'TBA') {
      const aArr = [aAwayName, aHomeName].sort();
      const bArr = [bAwayName, bHomeName].sort();
      if (aArr[0] === bArr[0] && aArr[1] === bArr[1]) return true;
      
      const match0 = aArr[0].includes(bArr[0]) || bArr[0].includes(aArr[0]);
      const match1 = aArr[1].includes(bArr[1]) || bArr[1].includes(aArr[1]);
      if (match0 && match1) return true;
  }

  // ULTIMATE FALLBACK: Cross-reference tracked identifiers
  const tA = norm(a.trackedAbbr);
  const tB = norm(b.trackedAbbr);
  const tIdA = norm(a.trackedId);
  const tIdB = norm(b.trackedId);
  if (tA !== 'TBA' && tB !== 'TBA' && tA !== tB) {
      const aHasB = aAwayId === tIdB || aHomeId === tIdB || aAwayAbbr === tB || aHomeAbbr === tB || aAwayName.includes(tB) || aHomeName.includes(tB);
      const bHasA = bAwayId === tIdA || bHomeId === tIdA || bAwayAbbr === tA || bHomeAbbr === tA || bAwayName.includes(tA) || bHomeName.includes(tA);
      
      const aBroken = aAwayId === 'TBA' || aHomeId === 'TBA' || aAwayAbbr === 'TBA' || aHomeAbbr === 'TBA';
      const bBroken = bAwayId === 'TBA' || bHomeId === 'TBA' || bAwayAbbr === 'TBA' || bHomeAbbr === 'TBA';
      
      if ((aHasB && bHasA) || (aHasB && bBroken) || (bHasA && aBroken)) return true;
  }

  return false;
};

// Evaluates the quality of a news headline
export const isValidHeadline = (title) => {
  if (!title || typeof title !== 'string') return false;
  const trimmed = title.trim();
  
  if (trimmed.length < 15 || trimmed.length > 250) return false; 
  if (trimmed.includes('<') || trimmed.includes('>')) return false; 
  if (trimmed.includes('http://') || trimmed.includes('https://')) return false; 
  if (trimmed.split(' ').length < 4) return false; 
  
  return true;
};

// Weather Code Map (Open-Meteo)
export const getWeatherDescription = (code) => {
  const map = {
    0: 'Clear', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Fog', 51: 'Light Drizzle', 53: 'Moderate Drizzle', 55: 'Heavy Drizzle',
    56: 'Freezing Drizzle', 57: 'Freezing Drizzle', 61: 'Light Rain', 63: 'Moderate Rain',
    65: 'Heavy Rain', 66: 'Freezing Rain', 67: 'Freezing Rain', 71: 'Light Snow', 73: 'Snow',
    75: 'Heavy Snow', 77: 'Snow Grains', 80: 'Rain Showers', 81: 'Heavy Rain Showers',
    82: 'Storm', 85: 'Snow Showers', 86: 'Snow Showers', 95: 'Thunderstorms', 96: 'Thunderstorms',
    99: 'Thunderstorms'
  };
  return map[code] || 'Clear';
};

// Translates weather codes into background gradients
export const getWeatherBackground = (code, isDay = 1) => {
  if (isDay) {
      if ([0, 1].includes(code)) return ['#4A90E2', '#5CA0EB']; // Clear Day
      if ([2, 3].includes(code)) return ['#5C88C4', '#7A9DCE']; // Cloudy Day
      if ([45, 48].includes(code)) return ['#7890A8', '#90A4B8']; // Fog Day
      if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81].includes(code)) return ['#4A6B9C', '#607DAB']; // Rain Day
      if ([82, 95, 96, 99].includes(code)) return ['#354B68', '#4A6282']; // Storm Day
      if ([71, 73, 75, 77, 85, 86].includes(code)) return ['#7FA1D6', '#98B4E0']; // Snow Day
      return ['#4A90E2', '#5CA0EB'];
  } else {
      if ([0, 1].includes(code)) return ['#0B1D3A', '#162F56']; // Clear Night
      if ([2, 3].includes(code)) return ['#1A2A42', '#2A3B58']; // Cloudy Night
      if ([45, 48].includes(code)) return ['#2C3E50', '#3D5268']; // Fog Night
      if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81].includes(code)) return ['#182B49', '#243B5E']; // Rain Night
      if ([82, 95, 96, 99].includes(code)) return ['#101A2B', '#1B2A42']; // Storm Night
      if ([71, 73, 75, 77, 85, 86].includes(code)) return ['#2A3F63', '#3B527A']; // Snow Night
      return ['#0B1D3A', '#162F56'];
  }
};

// Gets the emoji corresponding to weather conditions
export const getWeatherEmoji = (code, isDay = 1) => {
  if (!isDay) {
    const nightIcons = { 0: '🌙', 1: '🌙', 2: '☁️', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️', 71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️', 80: '🌦️', 81: '🌧️', 82: '⛈️', 85: '🌨️', 86: '🌨️', 95: '⛈️', 96: '⛈️', 99: '⛈️' };
    return nightIcons[code] || '🌙';
  }
  const icons = { 0: '☀️', 1: '🌤️', 2: '⛅️', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌧️', 56: '🌧️', 57: '🌧️', 61: '🌧️', 63: '🌧️', 65: '🌧️', 66: '🌧️', 67: '🌧️', 71: '🌨️', 73: '🌨️', 75: '🌨️', 77: '🌨️', 80: '🌦️', 81: '🌧️', 82: '⛈️', 85: '🌨️', 86: '🌨️', 95: '⛈️', 96: '⛈️', 99: '⛈️' };
  return icons[code] || '☀️';
};

// Decodes common HTML entities, hex/decimal entities, and handles multi-pass decoding for double-encoded text
export const decodeHtmlEntities = (text) => {
  if (!text) return '';
  const entities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&#039;': "'",
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&#8216;': "'",
    '&#8217;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&#8220;': '"',
    '&#8221;': '"',
    '&ndash;': '–',
    '&#8211;': '–',
    '&mdash;': '—',
    '&#8212;': '—',
    '&hellip;': '…',
    '&#8230;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&bull;': '•',
    '&middot;': '·',
    '&raquo;': '»',
  };

  let res = text;
  for (let pass = 0; pass < 2; pass++) {
    for (const [entity, replacement] of Object.entries(entities)) {
      res = res.replaceAll(entity, replacement);
    }
    res = res.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try { return String.fromCharCode(parseInt(hex, 16)); } catch { return ''; }
    });
    res = res.replace(/&#([0-9]+);/g, (_, dec) => {
      try { return String.fromCharCode(parseInt(dec, 10)); } catch { return ''; }
    });
  }
  return res;
};

// Cleans raw HTML/XML content, strips media/scripts, preserves paragraph and list formatting, and decodes HTML entities
export const cleanHtmlAndExtractText = (rawHtml) => {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let text = rawHtml;

  // 1. Remove CDATA markers
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');

  // 2. Decode basic XML entities first so that encoded tags like &lt;p&gt; become <p>
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  // 3. Remove comments, scripts, styles, iframes, figures, svgs, images, audio, video
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<(iframe|figure|svg|form|canvas|audio|video)[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<(img|source|hr|meta|link)[^>]*\/?>/gi, '');

  // 4. Block elements (opening & closing) to double newlines (paragraphs on their own lines)
  text = text.replace(/<\/?(p|div|h[1-6]|blockquote|section|article|header|footer|aside|address)[^>]*>/gi, '\n\n');

  // 5. Line breaks to single newline
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // 6. List items and table rows
  text = text.replace(/<li[^>]*>/gi, '\n• ');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/?tr[^>]*>/gi, '\n');
  text = text.replace(/<\/?(td|th)[^>]*>/gi, ' ');

  // 7. Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // 8. Decode all remaining HTML entities
  text = decodeHtmlEntities(text);

  // 9. Normalize whitespace and clean up
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/\u00A0/g, ' ');
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  text = text.replace(/[\u2028\u2029]/g, '\n\n');
  
  // Clean trailing spaces per line and multiple inline spaces
  text = text.split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n');

  // Collapse 3+ newlines to 2 newlines (for clean paragraph separation)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
};

// Estimates visual line height / space consumption of a formatted text
export const estimateVisualLines = (text, charsPerLine = 75) => {
  if (!text) return 0;
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  let totalLines = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const linesInP = p.split('\n');
    for (const line of linesInP) {
      totalLines += Math.max(1, Math.ceil(line.length / charsPerLine));
    }
    if (i < paragraphs.length - 1) {
      totalLines += 1; // paragraph spacing visual equivalent
    }
  }
  return totalLines;
};

// Intelligently splits RSS item text across multiple cards if it exceeds visual capacity
export const splitRssItemIntoCards = (item, isTablet = false) => {
  const charsPerLine = isTablet ? 75 : 45;
  const maxLinesFirstCard = isTablet ? 11 : 5;
  const maxLinesOtherCards = isTablet ? 15 : 8;

  const rawBody = item.body || '';
  const totalEstimatedLines = estimateVisualLines(rawBody, charsPerLine);

  if (!rawBody || totalEstimatedLines <= maxLinesFirstCard) {
    return [{
      ...item,
      body: rawBody,
      pageNumber: 1,
      pageTotal: 1,
    }];
  }

  const paragraphs = rawBody.split(/\n\n+/).filter(Boolean);
  const cards = [];
  let currentCardText = '';
  let currentCardLines = 0;
  let isFirst = true;

  const maxBudget = () => isFirst ? maxLinesFirstCard : maxLinesOtherCards;

  const pushCard = () => {
    if (currentCardText.trim()) {
      cards.push(currentCardText.trim());
      currentCardText = '';
      currentCardLines = 0;
      isFirst = false;
    }
  };

  for (const para of paragraphs) {
    const paraLines = estimateVisualLines(para, charsPerLine);
    const spacingCost = currentCardText ? 1 : 0;

    if (currentCardLines + paraLines + spacingCost <= maxBudget()) {
      currentCardText = currentCardText ? `${currentCardText}\n\n${para}` : para;
      currentCardLines += paraLines + spacingCost;
    } else {
      if (paraLines <= maxLinesOtherCards) {
        pushCard();
        currentCardText = para;
        currentCardLines = paraLines;
      } else {
        // Single paragraph exceeds card capacity -> split by sentences or line breaks
        const sentenceDelim = /([.!?]\s+|\n)/;
        const parts = para.split(sentenceDelim);
        const sentences = [];
        for (let i = 0; i < parts.length; i += 2) {
          const sent = parts[i] + (parts[i + 1] || '');
          if (sent.trim()) sentences.push(sent.trim());
        }

        for (const sentence of sentences) {
          const sentLines = estimateVisualLines(sentence, charsPerLine);
          const sentSpacing = currentCardText ? 0.5 : 0;
          if (currentCardLines + sentLines + sentSpacing <= maxBudget()) {
            currentCardText = currentCardText ? `${currentCardText} ${sentence}` : sentence;
            currentCardLines += sentLines + sentSpacing;
          } else {
            pushCard();
            if (sentLines <= maxLinesOtherCards) {
              currentCardText = sentence;
              currentCardLines = sentLines;
            } else {
              // Extremely long sentence -> split by words
              const words = sentence.split(' ');
              for (const word of words) {
                const testText = currentCardText ? `${currentCardText} ${word}` : word;
                if (estimateVisualLines(testText, charsPerLine) <= maxBudget()) {
                  currentCardText = testText;
                  currentCardLines = estimateVisualLines(currentCardText, charsPerLine);
                } else {
                  pushCard();
                  currentCardText = word;
                  currentCardLines = estimateVisualLines(currentCardText, charsPerLine);
                }
              }
            }
          }
        }
      }
    }
  }

  pushCard();

  const totalPages = cards.length;
  return cards.map((chunk, idx) => ({
    ...item,
    body: chunk,
    pageNumber: idx + 1,
    pageTotal: totalPages,
  }));
};

// Normalizes division names for standard display and matching
export const normalizeDivisionName = (rawName = '', parentName = '') => {
  let name = String(rawName || '').trim();
  let parent = String(parentName || '').trim();

  const isAfc = parent.toUpperCase().includes('AFC') || name.toUpperCase().includes('AFC') || parent.toUpperCase().includes('AMERICAN FOOTBALL');
  const isNfc = parent.toUpperCase().includes('NFC') || name.toUpperCase().includes('NFC') || parent.toUpperCase().includes('NATIONAL FOOTBALL');
  const isAl = parent.toUpperCase().includes('AL') || name.toUpperCase().includes('AL') || parent.toUpperCase().includes('AMERICAN LEAGUE');
  const isNl = parent.toUpperCase().includes('NL') || name.toUpperCase().includes('NL') || parent.toUpperCase().includes('NATIONAL LEAGUE');

  if (isAfc && !name.toUpperCase().startsWith('AFC')) name = `AFC ${name}`;
  else if (isNfc && !name.toUpperCase().startsWith('NFC')) name = `NFC ${name}`;
  else if (isAl && !name.toUpperCase().startsWith('AL')) name = `AL ${name}`;
  else if (isNl && !name.toUpperCase().startsWith('NL')) name = `NL ${name}`;

  return name
    .replace(/American Football Conference/i, 'AFC')
    .replace(/National Football Conference/i, 'NFC')
    .replace(/American League/i, 'AL')
    .replace(/National League/i, 'NL')
    .replace(/Division/i, '')
    .replace(/Eastern/i, 'East')
    .replace(/Western/i, 'West')
    .replace(/Northern/i, 'North')
    .replace(/Southern/i, 'South')
    .replace(/\s+/g, ' ')
    .trim();
};

// Parses ESPN Standings JSON recursively and returns an array of division objects
export const parseEspnStandings = (stJson, sport, targetLeague) => {
  if (!stJson) return [];
  const divisions = [];

  const traverse = (node, parentName = '') => {
    if (!node) return;

    if (node.standings && Array.isArray(node.standings.entries) && node.standings.entries.length > 0) {
      const divName = normalizeDivisionName(node.name || node.abbreviation || 'Standings', parentName);
      const entries = node.standings.entries.map((entry, idx) => {
        const team = entry.team || {};
        const stats = entry.stats || [];

        const wins = stats.find(s => s.name === 'wins')?.displayValue || stats.find(s => s.name === 'wins')?.value || '0';
        const losses = stats.find(s => s.name === 'losses')?.displayValue || stats.find(s => s.name === 'losses')?.value || '0';
        const ties = stats.find(s => s.name === 'ties')?.displayValue || stats.find(s => s.name === 'ties')?.value;
        const otLosses = stats.find(s => s.name === 'otLosses' || s.name === 'overtimeLosses')?.displayValue || stats.find(s => s.name === 'otLosses')?.value;
        const points = stats.find(s => s.name === 'points' || s.abbreviation === 'PTS')?.displayValue || stats.find(s => s.name === 'points')?.value;
        const winPct = stats.find(s => s.name === 'winPercent' || s.name === 'winPercentage')?.displayValue || stats.find(s => s.name === 'winPercent')?.value;
        const gb = stats.find(s => s.name === 'gamesBehind')?.displayValue || stats.find(s => s.name === 'gamesBehind')?.value || '-';
        const streak = stats.find(s => s.name === 'streak')?.displayValue || stats.find(s => s.name === 'streak')?.value;
        const diff = stats.find(s => s.name === 'pointDifferential' || s.name === 'differential')?.displayValue;

        let record = `${wins}-${losses}`;
        if (ties && ties !== '0') record += `-${ties}`;
        else if (otLosses && otLosses !== '0') record += `-${otLosses}`;

        let logo = team.logos?.[0]?.href || team.logo;
        if (!logo && team.id) {
          logo = `https://a.espncdn.com/i/teamlogos/${targetLeague}/500/${team.abbreviation?.toLowerCase() || team.id}.png`;
        }

        return {
          rank: idx + 1,
          id: String(team.id || ''),
          abbr: String(team.abbreviation || '').toUpperCase(),
          name: team.displayName || team.name || team.shortDisplayName || team.abbreviation || 'Team',
          logo,
          record,
          wins: String(wins),
          losses: String(losses),
          otLosses: otLosses ? String(otLosses) : null,
          points: points ? String(points) : null,
          winPct: winPct ? String(winPct).replace(/^0\./, '.') : null,
          gb: gb === '0' || gb === '0.0' ? '-' : String(gb),
          streak: streak ? String(streak) : null,
          diff: diff ? String(diff) : null,
        };
      });

      divisions.push({
        divisionName: divName,
        rawName: node.name || node.abbreviation,
        entries
      });
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(child => traverse(child, node.name || node.abbreviation || parentName));
    }
  };

  traverse(stJson);
  return divisions;
};

// Evaluates whether a zman should remain visible.
// Per user specification: zmanim do not disappear until midnight local time (11:59:59 PM)
// AFTER the time expires (e.g. Friday night candle lighting stays visible until 11:59:59 PM Friday night;
// Saturday Havdalah stays visible until 11:59:59 PM Saturday night).
export const isZmanActive = (zmanDate, currentMs = Date.now(), timeZone) => {
  if (!zmanDate) return false;
  const d = typeof zmanDate === 'number' ? new Date(zmanDate) : (zmanDate instanceof Date ? zmanDate : new Date(zmanDate));
  if (isNaN(d.getTime())) return false;

  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(d);

      const y = parts.find(p => p.type === 'year')?.value;
      const m = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;

      const nowParts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date(currentMs));

      const nowY = nowParts.find(p => p.type === 'year')?.value;
      const nowM = nowParts.find(p => p.type === 'month')?.value;
      const nowDay = nowParts.find(p => p.type === 'day')?.value;

      if (y && m && day && nowY && nowM && nowDay) {
        const zmanDateKey = parseInt(`${y}${m}${day}`, 10);
        const nowDateKey = parseInt(`${nowY}${nowM}${nowDay}`, 10);
        return nowDateKey <= zmanDateKey;
      }
    } catch (e) {}
  }

  // Fallback to local Date comparison:
  // Check if now's calendar date is on or before the zman's calendar date (until 23:59:59.999 of the zman's day)
  const now = new Date(currentMs);
  const zmanEndOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return now.getTime() <= zmanEndOfDay.getTime();
};