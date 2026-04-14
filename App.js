import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Platform, Image, Animated, Easing } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'; 
import { useKeepAwake } from 'expo-keep-awake';
import { useFonts } from 'expo-font';
import * as Location from 'expo-location';
import * as ScreenOrientation from 'expo-screen-orientation';

const fetchHeaders = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json, text/xml'
};

function TickerApp() {
  useKeepAwake();

  const [fontsLoaded] = useFonts({
    SFShields: require('./assets/Fonts/sf-display-shields-compressed-bold.otf'),
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayCycle, setDisplayCycle] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [hebrewDate, setHebrewDate] = useState("");
  const [alertsCount, setAlertsCount] = useState(0);
  const [havdalahTime, setHavdalahTime] = useState(null);
  
  // Animation value for the progress bar
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnimLeft = useRef(new Animated.Value(1)).current;
  const fadeAnimRight = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // 1. Format today's date for the API
    const d = new Date();
    const dateString = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');

    // 2. Fetch Base Hebrew Date
    fetch(`https://www.hebcal.com/converter?cfg=json&date=${dateString}&g2h=1&strict=1`, { headers: fetchHeaders })
        .then(res => res.json())
        .then(data => {
            let dateStr = "";
            // Construct readable English format: "26 Nisan 5786"
            if (data.hd && data.hm && data.hy) {
                dateStr = `${data.hd} ${data.hm} ${data.hy}`;
            } else if (data.hebrew) {
                dateStr = data.hebrew; // Fallback to Hebrew characters
            }
            
            // 3. Fetch specific events (like Sefirah) for today
            fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&start=${dateString}&end=${dateString}&o=on`)
                .then(r => r.json())
                .then(omerData => {
                    if (omerData.items) {
                        const omerEvent = omerData.items.find(item => item.category === 'omer');
                        if (omerEvent) {
                            dateStr += `\n${omerEvent.title}`;
                        }
                    }
                    setHebrewDate(dateStr || "Data Unavailable");
                })
                .catch(() => setHebrewDate(dateStr || "Data Unavailable")); 
        })
        .catch(err => {
            console.warn("Hebcal fetch failed:", err);
            setHebrewDate("Fetch Failed");
        });

    // Simulated Tzevah Adom Fetch
    setAlertsCount(Math.floor(Math.random() * 3));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const computeHavdalah = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setHavdalahTime('Location denied');
          return;
        }

        const loc = await Location.getCurrentPositionAsync({});
        const lat = loc.coords.latitude;
        const lon = loc.coords.longitude;

        // Prefer Hebcal's shabbat API for accurate havdalah times
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        const hebcalUrl = `https://www.hebcal.com/shabbat/?cfg=json&latitude=${lat}&longitude=${lon}&date=${dateStr}`;
        try {
          const hres = await fetch(hebcalUrl, { headers: fetchHeaders });
          if (hres.ok) {
            const hjson = await hres.json();
            const items = hjson.items || [];
            const hav = items.find(i => (i.category && i.category.toLowerCase() === 'havdalah') || (i.title && /havdalah/i.test(i.title)));
            if (hav && hav.date) {
              const havDate = new Date(hav.date);
              if (!cancelled) {
                setHavdalahTime(havDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
                return;
              }
            }
          }
        } catch (e) {
          // fall through to sunrise-sunset fallback
        }

        // Fallback: sunrise-sunset service (if Hebcal unavailable)
        const res = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${dateStr}&formatted=0`);
        if (!res.ok) throw new Error('Sunset fetch failed');
        const json = await res.json();
        const sunsetIso = json.results?.sunset;
        if (!sunsetIso) throw new Error('No sunset returned');

        const offsetMinutes = 72; // fallback community default
        const sunsetDate = new Date(sunsetIso);
        sunsetDate.setMinutes(sunsetDate.getMinutes() + offsetMinutes);

        if (!cancelled) {
          setHavdalahTime(sunsetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
        }
      } catch (e) {
        if (!cancelled) setHavdalahTime('Unavailable');
      }
    };

    computeHavdalah();
    const interval = setInterval(computeHavdalah, 1000 * 60 * 30);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const fetchData = useCallback(async () => {
      try {
        console.log("Syncing Real Premium Data...");

        // --- HEADLINE EVALUATOR ---
        const isValidHeadline = (title) => {
            if (!title || typeof title !== 'string') return false;
            const trimmed = title.trim();
            
            if (trimmed.length < 15 || trimmed.length > 250) return false; 
            if (trimmed.includes('<') || trimmed.includes('>')) return false; 
            if (trimmed.includes('http://') || trimmed.includes('https://')) return false; 
            if (trimmed.split(' ').length < 4) return false; 
            
            return true;
        };

        // --- 1. UNIVERSAL NEWS FETCH ENGINE ---
        const fetchRssFeed = async (url, sourceName) => {
            try {
                const res = await fetch(url, { headers: fetchHeaders });
                if (!res.ok) return [];
                const text = await res.text();
                
                const items = text.split(/<item>|<entry>/i);
                const parsedNews = [];
                
                for (let i = 1; i < items.length && parsedNews.length < 2; i++) {
                    const titleMatch = items[i].match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>/i) 
                                    || items[i].match(/<title[^>]*>(.*?)<\/title>/i);
                    
                    const dateMatch = items[i].match(/<(pubDate|updated|dc:date)[^>]*>(.*?)<\/\1>/i);
                    let dateStr = "Today";
                    
                    if (dateMatch && dateMatch[2]) {
                        const parsedDate = new Date(dateMatch[2]);
                        if (!isNaN(parsedDate.getTime())) {
                            const now = new Date();
                            const isToday = parsedDate.getDate() === now.getDate() && 
                                            parsedDate.getMonth() === now.getMonth() && 
                                            parsedDate.getFullYear() === now.getFullYear();
                            
                            const hours = parsedDate.getHours();
                            const minutes = parsedDate.getMinutes();
                            const ampm = hours >= 12 ? 'pm' : 'am';
                            const formattedHours = hours % 12 || 12;
                            const formattedMinutes = minutes.toString().padStart(2, '0');
                            const timeStr = `${formattedHours}:${formattedMinutes} ${ampm}`;
                            
                            if (isToday) {
                                dateStr = `Today at ${timeStr}`;
                            } else {
                                const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                                dateStr = `${monthNames[parsedDate.getMonth()]} ${parsedDate.getDate()} at ${timeStr}`;
                            }
                        }
                    }
                    
                    if (titleMatch) {
                        let cleanTitle = titleMatch[1]
                            .replace(/&#8216;/g, "'").replace(/&#8217;/g, "'")
                            .replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
                            .replace(/&#8211;/g, '-').replace(/&#8212;/g, '-')
                            .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
                            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
                            .replace(/&nbsp;/g, " ")
                            .replace(/<[^>]+>/g, ""); 
                        
                        if (isValidHeadline(cleanTitle)) {
                            parsedNews.push({ title: cleanTitle.trim(), source: sourceName, date: dateStr });
                        }
                    }
                }
                return parsedNews;
            } catch (err) {
                console.warn(`${sourceName} fetch failed:`, err.message);
                return [];
            }
        };

        const [toi, nyp, espnNews, apNews] = await Promise.all([
            fetchRssFeed('https://www.timesofisrael.com/feed/', 'The Times of Israel'),
            fetchRssFeed('https://nypost.com/sports/feed/', 'NY Post Sports'),
            fetchRssFeed('https://www.espn.com/espn/rss/news', 'ESPN'),
            fetchRssFeed('https://sports.yahoo.com/rss/', 'AP News / Yahoo') 
        ]);

        let allNews = [...toi, ...nyp, ...espnNews, ...apNews];
        if (allNews.length === 0) {
            allNews = [{ title: "News Feeds Offline", source: "System", date: "Today" }];
        }

        // --- 2. ESPN API FETCH ---
        const fetchEspnTeam = async (sport, league, abbr, teamName) => {
          let myTeamColor = '#15234b'; 
          let record = "0-0";
          let teamJson = {};
          
          try {
            const teamRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${abbr}`, { headers: fetchHeaders });
            if (teamRes.ok) {
                teamJson = await teamRes.json();
                if (teamJson.team?.color) myTeamColor = `#${teamJson.team.color}`;
                record = teamJson.team?.record?.items?.[0]?.summary || "0-0";
            }

            const fallbackCard = {
                type: 'SPORTS',
                data: {
                  league: league.toUpperCase(), date: 'OFFSEASON',
                  awayAbbr: 'TBA', awayScore: '-', awayName: 'Away',
                  awayLogo: `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr.toLowerCase()}.png`,
                  awayRecord: '',
                  homeAbbr: abbr, homeScore: '-', homeName: teamName,
                  homeLogo: `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr.toLowerCase()}.png`,
                  homeRecord: record,
                  status: 'No Active Games', situation: null,
                  topPlay: 'Awaiting schedule release...',
                  playerGlance: { name: teamName.toUpperCase(), subtext: '', stats: 'Offseason or Schedule Unavailable' },
                  teamColor: myTeamColor,
                  nextGame: { date: 'Schedule TBA', opponent: 'Opponent TBA' }
                }
            };

            const fetchSchedule = async (type, year) => {
                let url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${abbr}/schedule`;
                let params = [];
                if (type) params.push(`seasontype=${type}`);
                if (year) params.push(`season=${year}`);
                if (params.length > 0) url += `?${params.join('&')}`;

                const res = await fetch(url, { headers: fetchHeaders });
                if (!res.ok) return [];
                const json = await res.json();
                return json.events || [];
            };

            let events = await fetchSchedule();
            if (events.length === 0) events = await fetchSchedule(2); 
            if (events.length === 0) events = await fetchSchedule(3); 
            if (events.length === 0) events = await fetchSchedule(2, new Date().getFullYear()); 
            if (events.length === 0) events = await fetchSchedule(2, new Date().getFullYear() - 1); 
            
            const teamNextEvent = teamJson.team?.nextEvent?.[0];
            if (teamNextEvent && !events.some(e => e.id === teamNextEvent.id)) {
                events.unshift(teamNextEvent);
            }
            if (events.length === 0 && teamNextEvent) {
                events = [teamNextEvent];
            }

            if (events.length === 0) return fallbackCard;
            
            const liveEvent = events.find(e => e?.competitions?.[0]?.status?.type?.state === 'in');
            let pastGames = events.filter(e => e?.competitions?.[0]?.status?.type?.state === 'post');
            pastGames.sort((a, b) => new Date(b.date) - new Date(a.date));
            let upcomingGames = events.filter(e => e?.competitions?.[0]?.status?.type?.state === 'pre');
            upcomingGames.sort((a, b) => new Date(a.date) - new Date(b.date));
            let nextUpcoming = upcomingGames[0];
            let mostRecentPast = pastGames[0];
            
            const nextEventIsLive = teamNextEvent && teamNextEvent.competitions?.[0]?.status?.type?.state === 'in';
            const nextEventIsUpcoming = teamNextEvent && teamNextEvent.competitions?.[0]?.status?.type?.state === 'pre';
            
            let targetEvent;
            if (liveEvent) {
              targetEvent = liveEvent;
            } else if (nextEventIsLive) {
              targetEvent = teamNextEvent;
            } else {
              targetEvent = mostRecentPast || nextUpcoming || teamNextEvent || events[0];
            }

            if (!targetEvent) return fallbackCard;

            let dateText = "Recent";
            if (targetEvent.date) {
               const gameDate = new Date(targetEvent.date);
               dateText = gameDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            }

            const comp = targetEvent.competitions?.[0];
            if (!comp) return fallbackCard;

            const home = comp.competitors?.find(c => c.homeAway === 'home') || comp.competitors?.[0];
            const away = comp.competitors?.find(c => c.homeAway === 'away') || comp.competitors?.[1];
            if (!home || !away) return fallbackCard;
            
            const parseScore = (c) => {
              if (c?.score == null) return "0";
              if (typeof c.score === 'object') return c.score.displayValue ?? c.score.value ?? "0";
              return String(c.score);
            };

            const getLogoUrl = (team) => {
              if (!team) return null;
              if (team.logo) return team.logo;
              const logos = team.logos || [];
              const scoreboard = logos.find(l => l.rel?.includes('scoreboard'));
              return scoreboard?.href || logos[0]?.href || `https://a.espncdn.com/i/teamlogos/${league}/500/${team.abbreviation?.toLowerCase()}.png`;
            };

            const state = comp.status?.type?.state || targetEvent.status?.type?.state || 'pre';
            const gameDate = new Date(targetEvent.date);
            const now = new Date();
            const timeDiff = gameDate - now;
            
            let summaryJson = null;
            if (league === 'mlb' && (state === 'in' || state === 'post')) {
              try {
                const summaryRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${targetEvent.id}`, { headers: fetchHeaders });
                if (summaryRes.ok) {
                  summaryJson = await summaryRes.json();
                }
              } catch (e) {}
            }

            const summaryComp = summaryJson?.header?.competitions?.[0];
            const sourceComp = summaryComp || comp;
            const sourceStatus = sourceComp?.status || comp?.status;
            const sourceState = sourceStatus?.type?.state || state;
            const sourceStateKey = String(sourceState || '').toLowerCase();
            const isLiveState = sourceStateKey === 'in' || sourceStateKey === 'live' || sourceStateKey === 'active';
            const sourceHome = sourceComp?.competitors?.find(c => c.homeAway === 'home') || home;
            const sourceAway = sourceComp?.competitors?.find(c => c.homeAway === 'away') || away;
            const awayLogo = getLogoUrl(sourceAway.team || away.team);
            const homeLogo = getLogoUrl(sourceHome.team || home.team);
            const awayScoreValue = parseScore(sourceAway);
            const homeScoreValue = parseScore(sourceHome);
            const statusDetail = String(sourceStatus?.type?.detail || sourceStatus?.type?.shortDetail || targetEvent.status?.type?.detail || 'Final');
            let statusText = statusDetail;
            let situationObj = null;
            const currentSituation = league === 'mlb' ? (summaryJson?.situation || sourceComp?.situation || comp.situation || null) : null;
            
            if (league === 'mlb' && isLiveState && currentSituation) {
                const sit = currentSituation;
                const rawInning = sourceStatus?.type?.shortDetail || statusDetail;
                const inningLabel = String(rawInning).replace(/^Top\s+/i, '').replace(/^Bot(tom)?\s+/i, '').trim();
                const balls = sit.balls != null ? sit.balls : 0;
                const strikes = sit.strikes != null ? sit.strikes : 0;
                const outs = sit.outs != null ? sit.outs : 0;
                let onFirst = !!sit.onFirst;
                let onSecond = !!sit.onSecond;
                let onThird = !!sit.onThird;
                if (!onFirst && !onSecond && !onThird && typeof sit.baseState === 'string') {
                    const base = sit.baseState.trim();
                    if (base.length >= 3) {
                        onFirst = base[0] === '1';
                        onSecond = base[1] === '1';
                        onThird = base[2] === '1';
                    }
                }
                situationObj = {
                    onFirst,
                    onSecond,
                    onThird,
                    balls,
                    strikes,
                    outs,
                    inningLabel,
                    inningDirection: String(rawInning).startsWith('Top') ? 'TOP' : String(rawInning).startsWith('Bot') || String(rawInning).startsWith('Bottom') ? 'BOT' : '',
                };

                statusText = statusText.replace('Bot ', '▼ ').replace('Top ', '▲ ').replace('Mid ', '▶ ').replace('End ', '◀ ');
            }

            let topPlayText = "Game update available.";
            let leaderName = "Player Stats";
            let leaderStats = "Awaiting Data";
            let leaderSubtext = "Current Game Stats";

            const playFromSummary = (summary) => {
              if (!summary?.plays?.length) return null;
              const lastPlayResult = [...summary.plays].reverse().find(p => p.type === 'play-result' && p.text);
              if (lastPlayResult?.text) return lastPlayResult.text;
              return [...summary.plays].reverse().find(p => p.text)?.text || null;
            };

            if (isLiveState) {
                const summaryLastPlayText = playFromSummary(summaryJson);
                if (summaryLastPlayText) {
                    topPlayText = summaryLastPlayText;
                } else if (currentSituation?.lastPlay?.text) {
                    topPlayText = currentSituation.lastPlay.text;
                } else if (comp.headlines && comp.headlines.length > 0) {
                    topPlayText = comp.headlines[0].shortLinkText || comp.headlines[0].description;
                }
            } else if (comp.headlines && comp.headlines.length > 0) {
                topPlayText = comp.headlines[0].shortLinkText || comp.headlines[0].description;
            }

            let playerSectionHeader = 'PLAYER OF THE GAME';

            try {
              if (!summaryJson) {
                const summaryRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${targetEvent.id}`, { headers: fetchHeaders });
                if (summaryRes.ok) {
                  summaryJson = await summaryRes.json();
                }
              }

              if (state === 'post' && summaryJson?.article?.headline) {
                  topPlayText = summaryJson.article.headline;
              } else if (summaryJson?.article?.headline && topPlayText === "Game update available.") {
                  topPlayText = summaryJson.article.headline;
              }
              
              if (league === 'mlb') {
                  const liveBatter = (currentSituation?.batter || summaryJson?.situation?.batter || {});
                  const livePitcher = (currentSituation?.pitcher || summaryJson?.situation?.pitcher || {});
                  const rawInningStatus = sourceStatus?.type?.shortDetail || sourceStatus?.type?.detail || '';
                  const isMidInning = /mid/i.test(rawInningStatus);
                  const isFinalGame = sourceStateKey === 'post' || /final/i.test(rawInningStatus);
                  const hasLiveBatter = !!liveBatter?.playerId || !!liveBatter?.athlete;
                  const hasLivePitcher = !!livePitcher?.playerId || !!livePitcher?.athlete;

                  const resolveAthleteFromId = (situationPerson) => {
                      if (!situationPerson || !summaryJson?.boxscore?.players) return null;
                      const targetId = String(situationPerson.playerId || situationPerson.id || '');
                      if (!targetId) return null;
                      for (const teamBox of summaryJson.boxscore.players) {
                          for (const category of teamBox.statistics || []) {
                              if (!category?.athletes) continue;
                              for (const player of category.athletes) {
                                  const playerId = String(player.athlete?.id || player.athlete?.playerId || '');
                                  if (playerId === targetId) return player.athlete;
                              }
                          }
                      }
                      return null;
                  };

                  const findAthleteStats = (athlete, categoryMatchers) => {
                      if (!athlete || !summaryJson?.boxscore?.players) return null;
                      const athleteId = athlete.playerId ? String(athlete.playerId) : athlete.id ? String(athlete.id) : null;
                      const athleteName = athlete.shortName || athlete.displayName || athlete.name;
                      for (const teamBox of summaryJson.boxscore.players) {
                          const category = teamBox.statistics?.find(s => {
                              const key = String(s.name || s.type || '').toLowerCase();
                              return categoryMatchers.some(m => key.includes(m));
                          });
                          if (!category?.athletes) continue;
                          for (const player of category.athletes) {
                              const playerAthlete = player.athlete || {};
                              if (athleteId && String(playerAthlete.id) === athleteId) return { category, player };
                              if (athleteName && (playerAthlete.shortName === athleteName || playerAthlete.displayName === athleteName || playerAthlete.fullName === athleteName)) return { category, player };
                              if (athleteName && athleteName.includes(' ') && playerAthlete.displayName && playerAthlete.displayName.includes(athleteName.split(' ').slice(-1)[0])) return { category, player };
                          }
                      }
                      return null;
                  };

                  const formatBattingLine = (category, player) => {
                      const labels = (category.labels || category.names || []).map(l => String(l).toUpperCase().trim());
                      const index = (name) => labels.findIndex(l => l === name);
                      const hab = index('H-AB') > -1 ? player.stats[index('H-AB')] : null;
                      const hits = index('H') > -1 ? player.stats[index('H')] : null;
                      const abs = index('AB') > -1 ? player.stats[index('AB')] : null;
                      const avg = index('AVG') > -1 ? player.stats[index('AVG')] : null;
                      const hr = index('HR') > -1 ? player.stats[index('HR')] : index('HOMERUNS') > -1 ? player.stats[index('HOMERUNS')] : null;
                      const rbi = index('RBI') > -1 ? player.stats[index('RBI')] : index('RBIS') > -1 ? player.stats[index('RBIS')] : null;
                      const runs = index('R') > -1 ? player.stats[index('R')] : null;
                      const pieces = [];
                      if (hab) pieces.push(hab);
                      else if (hits != null && abs != null) pieces.push(`${hits}/${abs}`);
                      if (avg) pieces.push(`AVG: ${avg}`);
                      if (hr != null) pieces.push(`HR: ${hr}`);
                      if (rbi != null) pieces.push(`RBI: ${rbi}`);
                      if (runs != null) pieces.push(`R: ${runs}`);
                      return pieces.length ? pieces.join('  |  ') : null;
                  };

                  const formatPitchingLine = (category, player) => {
                      const labels = (category.labels || category.names || []).map(l => String(l).toUpperCase().trim());
                      const index = (name) => labels.findIndex(l => l === name);
                      const ip = index('IP') > -1 ? player.stats[index('IP')] : null;
                      const ks = index('K') > -1 ? player.stats[index('K')] : index('SO') > -1 ? player.stats[index('SO')] : null;
                      const bb = index('BB') > -1 ? player.stats[index('BB')] : null;
                      const era = index('ERA') > -1 ? player.stats[index('ERA')] : null;
                      const er = index('ER') > -1 ? player.stats[index('ER')] : null;
                      const pieces = [];
                      if (ip) pieces.push(`${ip} IP`);
                      if (ks) pieces.push(`${ks} K`);
                      if (bb) pieces.push(`${bb} BB`);
                      if (er) pieces.push(`ER: ${er}`);
                      if (era) pieces.push(`ERA: ${era}`);
                      return pieces.length ? pieces.join('  |  ') : null;
                  };

                  const resolvedBatter = liveBatter?.athlete || resolveAthleteFromId(liveBatter);
                  const resolvedPitcher = livePitcher?.athlete || resolveAthleteFromId(livePitcher);
                  const batterStats = findAthleteStats(resolvedBatter || liveBatter, ['batting', 'battingstats']);
                  const pitcherStats = findAthleteStats(resolvedPitcher || livePitcher, ['pitching', 'pitcherstats']);

                  if (isLiveState && hasLiveBatter) {
                      playerSectionHeader = 'AT-BAT';
                      const batterName = resolvedBatter?.shortName || resolvedBatter?.displayName || liveBatter?.shortName || liveBatter?.displayName || liveBatter?.name || 'Current Batter';
                      const pitcherName = resolvedPitcher?.shortName || resolvedPitcher?.displayName || livePitcher?.shortName || livePitcher?.displayName || 'Pitcher';
                      leaderName = batterName;
                      leaderSubtext = `vs ${pitcherName}`;
                      const batterLine = batterStats ? formatBattingLine(batterStats.category, batterStats.player) : null;
                      const pitcherLine = pitcherStats ? formatPitchingLine(pitcherStats.category, pitcherStats.player) : null;
                      leaderStats = batterLine || liveBatter.summary || 'At Bat';

                      if (hasLivePitcher) {
                          const pitcherLineText = pitcherLine || livePitcher.summary || 'Pitching';
                          leaderStats += pitcherLineText ? `\n${pitcherLineText}` : '';
                      }
                  } else if ((isMidInning || isFinalGame) && summaryJson?.boxscore?.players) {
                      playerSectionHeader = 'PLAYER OF THE GAME';
                      let bestScore = -1;
                      summaryJson.boxscore.players.forEach(teamBox => {
                          const batters = teamBox.statistics?.find(s => s.name === 'batting' || s.type === 'batting');
                          if (batters && batters.athletes) {
                              const labels = (batters.labels || batters.names || []).map(l => String(l).toUpperCase().trim());
                              const hrIdx = labels.findIndex(l => l === 'HR' || l === 'HOMERUNS');
                              const rbiIdx = labels.findIndex(l => l === 'RBI' || l === 'RBIS');
                              const rIdx = labels.findIndex(l => l === 'R' || l === 'RUNS');
                              const hIdx = labels.findIndex(l => l === 'H' || l === 'HITS');
                              const abIdx = labels.findIndex(l => l === 'AB' || l === 'ATBATS');
                              const avgIdx = labels.findIndex(l => l === 'AVG');

                              batters.athletes.forEach(a => {
                                  if (!a.stats || a.didNotPlay) return;
                                  const hr = hrIdx > -1 ? parseInt(a.stats[hrIdx], 10) || 0 : 0;
                                  const rbi = rbiIdx > -1 ? parseInt(a.stats[rbiIdx], 10) || 0 : 0;
                                  const runs = rIdx > -1 ? parseInt(a.stats[rIdx], 10) || 0 : 0;
                                  const hits = hIdx > -1 ? parseInt(a.stats[hIdx], 10) || 0 : 0;
                                  const abs = abIdx > -1 ? parseInt(a.stats[abIdx], 10) || 0 : 0;
                                  const avg = avgIdx > -1 ? a.stats[avgIdx] : '.000';
                                  const score = (hr * 4) + (rbi * 2) + runs + hits;

                                  if (score > bestScore) {
                                      bestScore = score;
                                      const name = a.athlete?.shortName || a.athlete?.displayName || 'Player';
                                      const teamAbbr = teamBox.team?.abbreviation || '';
                                      leaderName = teamAbbr ? `${name} (${teamAbbr})` : name;
                                      leaderSubtext = `Season Avg: ${avg}`;
                                      leaderStats = `H/AB: ${hits}/${abs}  |  R: ${runs}  |  RBI: ${rbi}  |  HR: ${hr}`;
                                  }
                              });
                          }
                      });
                  } else {
                      playerSectionHeader = isFinalGame ? 'PLAYER OF THE GAME' : 'CURRENT GAME';
                      if (isLiveState && !hasLiveBatter) {
                          if (livePitcher?.athlete) {
                              leaderName = livePitcher.athlete.shortName;
                              leaderSubtext = livePitcher.summary ? `vs ${livePitcher.athlete.shortName}` : 'Awaiting batter';
                              leaderStats = livePitcher.summary || topPlayText || 'Live updates available';
                          } else {
                              leaderName = 'LIVE ACTION';
                              leaderSubtext = 'Current status';
                              leaderStats = topPlayText || 'Live updates available';
                          }
                      }
                  }
              }
              else if (league === 'nba') {
                  let bestScore = -1;
                  if (summaryJson.boxscore?.players) {
                      summaryJson.boxscore.players.forEach(teamBox => {
                          const stats = teamBox.statistics?.[0]; 
                          if (stats && stats.athletes) {
                              const labels = (stats.labels || stats.names || []).map(l => String(l).toUpperCase().trim());
                              const ptsIdx = labels.findIndex(l => l === 'PTS' || l === 'POINTS');
                              const rebIdx = labels.findIndex(l => l === 'REB' || l === 'REBOUNDS' || l === 'TOT');
                              const astIdx = labels.findIndex(l => l === 'AST' || l === 'ASSISTS');

                              stats.athletes.forEach(a => {
                                  if (!a.stats || a.didNotPlay) return; 
                                  const pts = ptsIdx > -1 ? parseInt(a.stats[ptsIdx], 10) || 0 : 0;
                                  const reb = rebIdx > -1 ? parseInt(a.stats[rebIdx], 10) || 0 : 0;
                                  const ast = astIdx > -1 ? parseInt(a.stats[astIdx], 10) || 0 : 0;
                                  const score = pts + reb + ast;
                                  
                                  if (score > bestScore && score > 0) {
                                      bestScore = score;
                                      const name = a.athlete?.shortName || a.athlete?.displayName || "Player";
                                      const teamAbbr = teamBox.team?.abbreviation || "";
                                      leaderName = teamAbbr ? `${name} (${teamAbbr})` : name;
                                      leaderSubtext = "Game Leader";
                                      leaderStats = `PTS: ${pts}  |  REB: ${reb}  |  AST: ${ast}`;
                                  }
                              });
                          }
                      });
                  }
              }
              else if (league === 'nhl') {
                  let bestScore = -1;
                  let bestGoalieSaves = -1;
                  let bestGoalieName = "";
                  let bestGoalieStats = "";

                  if (summaryJson.boxscore?.players) {
                      summaryJson.boxscore.players.forEach(teamBox => {
                          const teamAbbr = teamBox.team?.abbreviation || "";

                          const skaterStats = teamBox.statistics?.find(s => s.name?.toLowerCase().includes('skater')) || teamBox.statistics?.[0];
                          if (skaterStats && skaterStats.athletes) {
                              const labels = (skaterStats.labels || skaterStats.names || []).map(l => String(l).toUpperCase().trim());
                              const gIdx = labels.findIndex(l => l === 'G' || l === 'GOALS');
                              const aIdx = labels.findIndex(l => l === 'A' || l === 'ASSISTS');
                              const ptsIdx = labels.findIndex(l => l === 'PTS' || l === 'POINTS');
                              const sogIdx = labels.findIndex(l => l === 'SOG' || l === 'S' || l === 'SHOTS');

                              skaterStats.athletes.forEach(a => {
                                  if (!a.stats || a.didNotPlay) return; 
                                  const g = gIdx > -1 ? parseInt(a.stats[gIdx], 10) || 0 : 0;
                                  const ast = aIdx > -1 ? parseInt(a.stats[aIdx], 10) || 0 : 0;
                                  const pts = ptsIdx > -1 ? parseInt(a.stats[ptsIdx], 10) || 0 : 0;
                                  const sog = sogIdx > -1 ? parseInt(a.stats[sogIdx], 10) || 0 : 0;
                                  const score = (g * 4) + (ast * 2) + sog + (pts * 2);
                                  
                                  if (score > bestScore && score > 0) {
                                      bestScore = score;
                                      const name = a.athlete?.shortName || a.athlete?.displayName || "Player";
                                      leaderName = teamAbbr ? `${name} (${teamAbbr})` : name;
                                      leaderSubtext = "Top Skater";
                                      leaderStats = `G: ${g}  |  A: ${ast}  |  PTS: ${pts}  |  SOG: ${sog}`;
                                  }
                              });
                          }

                          const goalieStats = teamBox.statistics?.find(s => s.name?.toLowerCase().includes('goalie') || s.name?.toLowerCase().includes('goaltending'));
                          if (goalieStats && goalieStats.athletes) {
                              const labels = (goalieStats.labels || goalieStats.names || []).map(l => String(l).toUpperCase().trim());
                              const svIdx = labels.findIndex(l => l === 'SV' || l === 'SAVES');
                              const saIdx = labels.findIndex(l => l === 'SA' || l === 'SHOTS' || l === 'SHOTS AGAINST');
                              const gaIdx = labels.findIndex(l => l === 'GA' || l === 'GOALS AGAINST');
                              const svPctIdx = labels.findIndex(l => l === 'SV%' || l === 'PCT' || l === 'SAVE PCT');

                              goalieStats.athletes.forEach(a => {
                                  if (!a.stats || a.didNotPlay) return; 
                                  const sv = svIdx > -1 ? parseInt(a.stats[svIdx], 10) || 0 : 0;
                                  const sa = saIdx > -1 ? parseInt(a.stats[saIdx], 10) || 0 : 0;
                                  const ga = gaIdx > -1 ? parseInt(a.stats[gaIdx], 10) || 0 : 0;
                                  const svPct = svPctIdx > -1 ? a.stats[svPctIdx] : '.000';
                                  
                                  if (sv > bestGoalieSaves) {
                                      bestGoalieSaves = sv;
                                      const name = a.athlete?.shortName || a.athlete?.displayName || "Goalie";
                                      bestGoalieName = teamAbbr ? `${name} (${teamAbbr})` : name;
                                      bestGoalieStats = `SV: ${sv}  |  SA: ${sa}  |  GA: ${ga}  |  SV%: ${svPct}`;
                                  }
                              });
                          }
                      });
                  }

                  if (bestScore <= 0 && bestGoalieSaves > -1) {
                      leaderName = bestGoalieName;
                      leaderSubtext = "Top Goalie";
                      leaderStats = bestGoalieStats;
                  }
                  
                  if (summaryJson.threeStars && summaryJson.threeStars.length > 0) {
                     const firstStar = summaryJson.threeStars[0];
                     if (firstStar.athlete) {
                         leaderName = firstStar.athlete.shortName || firstStar.athlete.displayName;
                         leaderSubtext = "1st Star of the Game";
                         if (leaderStats === "Awaiting Data") {
                             leaderStats = firstStar.displayValue || "Standout Performer";
                         }
                     }
                  }
              }
              else if (league === 'nfl') {
                  if (summaryJson.boxscore?.players) {
                      let bestScore = -1;
                      ['passing', 'rushing', 'receiving'].forEach(statType => {
                          summaryJson.boxscore.players.forEach(teamBox => {
                              const stats = teamBox.statistics?.find(s => s.name === statType);
                              if (stats && stats.athletes) {
                                  const labels = (stats.labels || stats.names || []).map(l => String(l).toUpperCase().trim());
                                  const ydsIdx = labels.findIndex(l => l === 'YDS' || l === 'YARDS');
                                  const tdIdx = labels.findIndex(l => l === 'TD' || l === 'TDS');
                                  
                                  stats.athletes.forEach(a => {
                                      if (!a.stats || a.didNotPlay) return;
                                      const yds = ydsIdx > -1 ? parseInt(a.stats[ydsIdx], 10) || 0 : 0;
                                      const tds = tdIdx > -1 ? parseInt(a.stats[tdIdx], 10) || 0 : 0;
                                      const score = yds + (tds * 50); 
          
                                      if (score > bestScore) {
                                          bestScore = score;
                                          const name = a.athlete?.shortName || a.athlete?.displayName || "Player";
                                          const teamAbbr = teamBox.team?.abbreviation || "";
                                          leaderName = teamAbbr ? `${name} (${teamAbbr})` : name;
                                          leaderSubtext = `Top ${statType.charAt(0).toUpperCase() + statType.slice(1)}`;
                                          leaderStats = `YDS: ${yds}  |  TD: ${tds}`;
                                      }
                                  });
                              }
                          });
                      });
                  }
              }

              if (leaderStats === "Awaiting Data" || leaderStats.includes("Awaiting")) {
                 let bestCat = null;
                 const leaderSources = [summaryJson.leaders, comp.leaders];
                 
                 for (const source of leaderSources) {
                     if (source && source.length > 0) {
                         bestCat = source.find(l => ['points', 'goals', 'passingYards', 'homeRuns', 'wins'].includes(l.name)) || source[0];
                         if (bestCat) break;
                     }
                 }
                 
                 if (bestCat?.leaders?.[0]) {
                     const athlete = bestCat.leaders[0].athlete;
                     leaderName = athlete.displayName || athlete.shortName;
                     leaderSubtext = "Game Leader";
                     leaderStats = `${bestCat.displayName || bestCat.shortDisplayName || bestCat.name}: ${bestCat.leaders[0].displayValue}`;
                 } else if (topPlayText && topPlayText !== "Game update available." && state !== 'in') {
                     leaderName = "GAME HIGHLIGHT";
                     leaderSubtext = "Top Story";
                     leaderStats = topPlayText;
                 }
              }
            } catch(summaryErr) {
              if (comp.leaders && comp.leaders.length > 0) {
                 const bestLeader = comp.leaders.find(l => l.name !== 'winningPitcher' && l.name !== 'losingPitcher') || comp.leaders[0];
                 if (bestLeader?.leaders?.[0]) {
                     const athlete = bestLeader.leaders[0].athlete;
                     leaderName = athlete.displayName || athlete.shortName;
                     leaderStats = bestLeader.leaders[0].displayValue;
                 }
              }
            }

            if (topPlayText === "Game update available." && leaderName !== "Player Stats" && leaderName !== "GAME HIGHLIGHT") {
                topPlayText = state === 'in' ? 'Live updates currently unavailable.' : `${leaderName} led the game.`;
            }

            let nextGameText = "Schedule TBA";
            let nextOpponent = "";
            if (teamJson.team?.nextEvent?.[0]) {
                const nextEv = teamJson.team.nextEvent[0];
                const nextDate = new Date(nextEv.date);
                
                const isToday = nextDate.toDateString() === new Date().toDateString();
                const dateFmt = isToday ? "Today" : nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const timeFmt = nextDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                
                nextGameText = `${dateFmt} at ${timeFmt}`;
                
                const nextComp = nextEv.competitions?.[0];
                if (nextComp) {
                    const nextOpp = nextComp.competitors.find(c => c.team.abbreviation !== abbr);
                    if (nextOpp) {
                        const isHome = nextOpp.homeAway === 'away'; // If opponent is away, we are home
                        nextOpponent = `${isHome ? 'vs' : '@'} ${nextOpp.team.shortDisplayName}`;
                    }
                }
            }

            const myTeamIsHome = home.team.abbreviation === abbr;

            let homeRecord = '';
            if (home.team.abbreviation === abbr) {
              homeRecord = record;
            } else if (home.team.record && home.team.record.items && home.team.record.items[0]) {
              homeRecord = home.team.record.items[0].summary;
            } else {
              try {
                const homeRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${home.team.abbreviation}`, { headers: fetchHeaders });
                if (homeRes.ok) {
                  const homeJson = await homeRes.json();
                  homeRecord = homeJson.team?.record?.items?.[0]?.summary || '';
                }
              } catch (e) {}
            }

            let awayRecord = '';
            if (away.team.record && away.team.record.items && away.team.record.items[0]) {
              awayRecord = away.team.record.items[0].summary;
            } else {
              try {
                const awayRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${away.team.abbreviation}`, { headers: fetchHeaders });
                if (awayRes.ok) {
                  const awayJson = await awayRes.json();
                  awayRecord = awayJson.team?.record?.items?.[0]?.summary || '';
                }
              } catch (e) {}
            }

            return {
              type: 'SPORTS',
              data: {
                league: league.toUpperCase(),
                date: dateText,
                awayAbbr: sourceAway.team.abbreviation || away.team.abbreviation,
                awayScore: awayScoreValue,
                awayRecord: awayRecord,
                awayName: sourceAway.team.name || sourceAway.team.shortDisplayName || away.team.name || away.team.shortDisplayName,
                awayLogo: awayLogo,
                homeAbbr: sourceHome.team.abbreviation || home.team.abbreviation,
                homeScore: homeScoreValue,
                homeRecord: homeRecord,
                homeName: sourceHome.team.name || sourceHome.team.shortDisplayName || home.team.name || home.team.shortDisplayName,
                homeLogo: homeLogo,
                status: statusText,
                situation: situationObj,
                topPlay: topPlayText,
                teamColor: myTeamColor,
                nextGame: { date: nextGameText, opponent: nextOpponent },
                playerSectionHeader: playerSectionHeader,
                playerGlance: {
                  name: `${leaderName.toUpperCase()}`,
                  subtext: leaderSubtext,
                  stats: leaderStats
                }
              }
            };
          } catch (error) {
            console.warn(`ESPN fetch failed for ${abbr}:`, error.message);
            return { type: 'ERROR', data: null };
          }
        };

        // --- 3. PWHL FETCH ---
        const fetchPwhlTeam = async (teamName, abbr) => {
          const pwhlTeamColor = '#002855'; 

          try {
            const seasonsUrl = 'https://lscluster.hockeytech.com/feed/index.php?feed=modulekit&view=seasons&key=446521baf8c38984&client_code=pwhl';
            const seasonsRes = await fetch(seasonsUrl, { headers: fetchHeaders });
            const seasonsJson = await seasonsRes.json();
            
            const activeSeasonId = seasonsJson?.SiteKit?.Seasons?.[0]?.season_id || '5';

            const pwhlUrl = `https://lscluster.hockeytech.com/feed/index.php?feed=modulekit&view=schedule&key=446521baf8c38984&client_code=pwhl&season_id=${activeSeasonId}`;
            const res = await fetch(pwhlUrl, { headers: fetchHeaders });
            if (!res.ok) throw new Error("PWHL API failed");
            
            const json = await res.json();
            const games = json?.SiteKit?.Schedule || [];
            
            const myGames = games.filter(g => 
               g.home_team_name.includes(teamName) || g.visiting_team_name.includes(teamName) ||
               g.home_team_name.includes('New York') || g.visiting_team_name.includes('New York')
            );

            if (myGames.length === 0) return { type: 'ERROR' };
            
            myGames.sort((a, b) => {
                const dateA = new Date(a.date_played);
                const dateB = new Date(b.date_played);
                return dateA - dateB;
            });

            let pastGames = myGames.filter(g => String(g.status) !== '1' && String(g.status) !== 'Scheduled' && String(g.status) !== '2');
            let upcomingGames = myGames.filter(g => String(g.status) === '1' || String(g.status) === 'Scheduled');
            let nextUpcoming = upcomingGames[0];
            let mostRecentPast = pastGames[pastGames.length - 1]; // since sorted ascending
            
            let targetGame;
            if (nextUpcoming && (new Date(nextUpcoming.date_played) - new Date()) <= 10 * 60 * 1000) {
              targetGame = nextUpcoming;
            } else {
              targetGame = mostRecentPast || nextUpcoming || myGames[0];
            }

            if (!targetGame) return { type: 'ERROR' };

            let dateText = "Recent";
            if (targetGame.date_played) {
               try {
                 const dateStr = targetGame.date_played.split(' ')[0]; 
                 const [year, month, day] = dateStr.split('-');
                 if (year && month && day) {
                     const gameDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                     dateText = gameDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                 }
               } catch(e) {}
            }

            let statusText = 'Final';
            const statCode = String(targetGame.status);
            if (targetGame.game_status) statusText = targetGame.game_status; 
            else if (['1', 'Scheduled'].includes(statCode)) statusText = 'Scheduled';
            else if (['2', 'In Progress'].includes(statCode)) statusText = 'Live';
            else if (['3', '4', '5'].includes(statCode)) statusText = 'Final';

            const myTeamIsHome = targetGame.home_team_name.includes(teamName) || targetGame.home_team_name.includes('New York');
            
            let myTeamDisplay = abbr;
            if (targetGame.home_wins !== undefined && targetGame.visiting_wins !== undefined) {
                 myTeamDisplay = `${abbr}(${myTeamIsHome ? targetGame.home_wins : targetGame.visiting_wins}-${myTeamIsHome ? targetGame.home_losses : targetGame.visiting_losses})`; 
            }

            const upcomingGame = myGames.find(g => String(g.status) === '1' || String(g.status) === 'Scheduled');
            let nextGameText = "Schedule TBA";
            let nextOpponent = "";
            if (upcomingGame && upcomingGame.date_played) {
                try {
                    const dateParts = upcomingGame.date_played.split(' ');
                    const [year, month, day] = dateParts[0].split('-');
                    const [hour, min] = dateParts[1] ? dateParts[1].split(':') : ['19', '00'];
                    
                    const nextDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(min));
                    const isToday = nextDate.toDateString() === new Date().toDateString();
                    const dateFmt = isToday ? "Today" : nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    const timeFmt = nextDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    
                    nextGameText = `${dateFmt} at ${timeFmt}`;
                    
                    const isNextHome = upcomingGame.home_team_name.includes(teamName) || upcomingGame.home_team_name.includes('New York');
                    nextOpponent = `${isNextHome ? 'vs' : '@'} ${isNextHome ? upcomingGame.visiting_team_name : upcomingGame.home_team_name}`;
                } catch(e) {}
            }

            return {
              type: 'SPORTS',
              data: {
                league: 'PWHL',
                date: dateText,
                awayAbbr: targetGame.visiting_team_code,
                awayScore: targetGame.visiting_goal_count || "0",
                awayRecord: (targetGame.visiting_wins !== undefined && targetGame.visiting_losses !== undefined) ? `${targetGame.visiting_wins}-${targetGame.visiting_losses}` : '',
                awayName: targetGame.visiting_team_name,
                awayLogo: `https://assets.leaguestat.com/pwhl/logos/50x50/${targetGame.visiting_team}.png`,
                homeAbbr: targetGame.home_team_code,
                homeScore: targetGame.home_goal_count || "0",
                homeRecord: (targetGame.home_wins !== undefined && targetGame.home_losses !== undefined) ? `${targetGame.home_wins}-${targetGame.home_losses}` : '',
                homeName: targetGame.home_team_name,
                homeLogo: `https://assets.leaguestat.com/pwhl/logos/50x50/${targetGame.home_team}.png`,
                status: statusText,
                situation: null,
                topPlay: 'Data officially synced from thepwhl.com.',
                teamColor: pwhlTeamColor,
                nextGame: { date: nextGameText, opponent: nextOpponent },
                playerGlance: { name: 'GAME MVP', subtext: 'Boxscore available at thepwhl.com', stats: 'G: --  |  A: --  |  PTS: --' }
              }
            };
          } catch (error) {
            console.warn(`PWHL fetch failed:`, error.message);
            return { type: 'ERROR' };
          }
        };

        const yankees = await fetchEspnTeam('baseball', 'mlb', 'NYY', 'Yankees'); 
        const knicks = await fetchEspnTeam('basketball', 'nba', 'NY', 'Knicks'); 
        const rangers = await fetchEspnTeam('hockey', 'nhl', 'NYR', 'Rangers'); 
        const giants = await fetchEspnTeam('football', 'nfl', 'NYG', 'Giants'); 
        const sirens = await fetchPwhlTeam('Sirens', 'NY');
        const mariners = await fetchEspnTeam('baseball', 'mlb', 'SEA', 'Mariners');

        const sportsCards = [yankees, knicks, rangers, giants, sirens, mariners].filter(item => item && item.type !== 'ERROR' && item.data);
        
        // GROUP ALGORITHM: News first, then Sports
        let grouped = [];
        allNews.forEach(news => grouped.push({ type: 'NEWS', data: news }));
        sportsCards.forEach(sport => grouped.push(sport));

        setDisplayCycle(grouped);
        setLoading(false);

      } catch (e) {
        console.error("Critical failure building display:", e);
      }
    }, []);

  useEffect(() => {
    fetchData();
    const dataInterval = setInterval(fetchData, 300000); 
    return () => clearInterval(dataInterval);
  }, [fetchData]);

  useEffect(() => {
    async function lockOrientation() {
      if (fontsLoaded && !loading) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      }
    }
    lockOrientation().catch(err => console.warn("Orientation lock error:", err));
  }, [fontsLoaded, loading]);

  useEffect(() => {
    if (displayCycle.length === 0) return;

    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 8000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    const timer = setTimeout(() => {
      const nextIndex = (currentIndex + 1) % displayCycle.length;
      const currentItem = displayCycle[currentIndex];
      const nextItem = displayCycle[nextIndex];
      
      // Determine if we are transitioning from News to News
      const isNewsToNews = currentItem.type === 'NEWS' && nextItem.type === 'NEWS';

      // 1. Fade out the left panel conditionally
      if (!isNewsToNews) {
        Animated.timing(fadeAnimLeft, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }

      // 2. Always fade out the right panel
      Animated.timing(fadeAnimRight, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        
        // 3. Swap the card while it is invisible
        setCurrentIndex(nextIndex);
        
        // 4. Smoothly fade the content back in
        if (!isNewsToNews) {
          Animated.timing(fadeAnimLeft, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }).start();
        }
        
        Animated.timing(fadeAnimRight, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    }, 7700); // Trigger the fade 300ms before the 8s interval completes
    
    return () => clearTimeout(timer);
  }, [currentIndex, displayCycle.length]);

  useEffect(() => {
    if (displayCycle.length === 0) return;
    const nextIndex = (currentIndex + 1) % displayCycle.length;
    const nextItem = displayCycle[nextIndex];
    if (nextItem?.type === 'SPORTS') {
      fetchData();
    }
  }, [currentIndex, displayCycle.length, fetchData]);

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={styles.wrapper}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </SafeAreaView>
    );
  }

  if (loading || displayCycle.length === 0) {
    return (
      <SafeAreaView style={styles.wrapper}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </SafeAreaView>
    );
  }

  const currentItem = displayCycle[currentIndex % displayCycle.length];

  if (!currentItem || !currentItem.data) {
    return (
      <SafeAreaView style={styles.wrapper}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </SafeAreaView>
    );
  }

  const dynamicCardColor = currentItem.data.teamColor || '#15234b';
  const getLuminance = (hex) => {
    try {
      const c = hex.replace('#','');
      const r = parseInt(c.substring(0,2),16)/255;
      const g = parseInt(c.substring(2,4),16)/255;
      const b = parseInt(c.substring(4,6),16)/255;
      const a = [r,g,b].map(v => (v <= 0.03928) ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
      return 0.2126*a[0] + 0.7152*a[1] + 0.0722*a[2];
    } catch (e) {
      return 0;
    }
  };
  const cardLuminance = getLuminance(dynamicCardColor);
  const logoTint = cardLuminance < 0.25 ? '#FFFFFF' : undefined;
  const singleColorLogoPatterns = ['yankees', 'nyy', 'pinstripe'];
  const shouldTintLogo = (logoUri) => {
    if (!logoTint || !logoUri) return false;
    try {
      const lower = String(logoUri).toLowerCase();
      return singleColorLogoPatterns.some(p => lower.includes(p));
    } catch (e) { return false; }
  };
  const timeString = currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateString = currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const interpolatedWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%']
  });

  return (
    <SafeAreaView style={styles.wrapper}>
      {/* LEFT DASHBOARD PANEL */}
      <View style={styles.leftPanel}>
        <View style={styles.clockContainer}>
          <Text style={styles.timeText}>{timeString}</Text>
          <Text style={styles.dateText}>{dateString}</Text>
        </View>
        
        <View style={styles.divider} />
        
        <Animated.View style={{ opacity: fadeAnimLeft, width: '100%' }}>
          {currentItem.type === 'NEWS' ? (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>HEBREW DATE / SEFIRAH</Text>
                <Text style={styles.infoValue}>{hebrewDate || "Loading..."}</Text>
              </View>
              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>HAVDALAH</Text>
                <Text style={styles.infoValue}>{havdalahTime || 'Calculating...'}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>NEXT MATCHUP</Text>
                <Text style={styles.infoValue}>{currentItem.data.nextGame?.opponent || "Opponent TBA"}</Text>
              </View>
              <View style={styles.infoBlock}>
                <Text style={styles.infoLabel}>DATE & TIME</Text>
                <Text style={styles.infoValue}>{currentItem.data.nextGame?.date || "Schedule TBA"}</Text>
              </View>
            </View>
          )}
        </Animated.View>
      </View>

      {/* RIGHT CARD PANEL */}
      <View style={styles.rightPanel}>
        <Animated.View style={{ opacity: fadeAnimRight, width: '100%', alignItems: 'center' }}>
          {currentItem.type === 'NEWS' ? (
            <View style={[styles.card, { backgroundColor: '#15234b' }]}>
              <View style={styles.topSection}>
                 <Text style={styles.leagueText}>LATEST UPDATES • {currentItem.data.date}</Text>
                 <View style={styles.newsRow}>
                    <Text style={styles.newsHeadline}>{currentItem.data.title}</Text>
                 </View>
              </View>
              <View style={styles.playSection}>
                <View style={styles.playBar} />
                <Text style={styles.playText}>Source: {currentItem.data.source}</Text>
              </View>
              <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.3)' }]} />
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: dynamicCardColor }]}>
              
              <View style={styles.topSection}>
                <Text style={styles.leagueText}>{currentItem.data.league} • {currentItem.data.date}</Text>
                
                <View style={styles.scoreRow}>
                  {/* Away Team */}
                  <View style={styles.teamColLeft}>
                    <View style={styles.teamRow}>
                       {currentItem.data.awayLogo && (
                         <View style={styles.logoWrapper}>
                           <Image source={{ uri: currentItem.data.awayLogo }} style={[styles.teamLogo, shouldTintLogo(currentItem.data.awayLogo) && { tintColor: logoTint }]} resizeMode="contain" />
                         </View>
                       )}
                      <Text style={styles.scoreNum}>{currentItem.data.awayScore}</Text>
                    </View>
                    <Text style={styles.teamName}>{currentItem.data.awayAbbr}</Text>
                    <Text style={styles.teamRecord}>{currentItem.data.awayRecord || '0-0'}</Text>
                  </View>

                  {/* Center Status */}
                  <View style={styles.centerCol}>
                    {currentItem.data.league === 'MLB' && currentItem.data.situation ? (
                      <View style={styles.mlbLiveStatus}>
                        <Text style={styles.mlbCountText}>{`${currentItem.data.situation.balls}-${currentItem.data.situation.strikes}  •  ${currentItem.data.situation.outs} out${currentItem.data.situation.outs !== 1 ? 's' : ''}`}</Text>
                        <View style={styles.basesContainer}>
                          <View style={[styles.base, currentItem.data.situation.onSecond && styles.baseActive, styles.baseTop]} />
                          <View style={styles.basesRow}>
                            <View style={[styles.base, currentItem.data.situation.onThird && styles.baseActive]} />
                            <View style={[styles.base, currentItem.data.situation.onFirst && styles.baseActive]} />
                          </View>
                        </View>
                        <Text style={styles.mlbInningText}>{currentItem.data.situation.inningLabel || currentItem.data.status}</Text>
                      </View>
                    ) : (
                      <View style={styles.centerStatusFallback}>
                        <View style={styles.dotsRow}>
                          <View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} />
                        </View>
                        <Text style={[styles.statusText, currentItem.data.situation && { color: '#FFD700' }]}>{currentItem.data.status}</Text>
                      </View>
                    )}
                  </View>
                  {/* Home Team */}
                  <View style={styles.teamColRight}>
                    <View style={styles.teamRow}>
                       <Text style={styles.scoreNum}>{currentItem.data.homeScore}</Text>
                       {currentItem.data.homeLogo && (
                         <View style={styles.logoWrapper}>
                           <Image source={{ uri: currentItem.data.homeLogo }} style={[styles.teamLogo, shouldTintLogo(currentItem.data.homeLogo) && { tintColor: logoTint }]} resizeMode="contain" />
                         </View>
                       )}
                    </View>
                    <Text style={styles.teamNameRight}>{currentItem.data.homeAbbr}</Text>
                    <Text style={styles.teamRecordRight}>{currentItem.data.homeRecord || '0-0'}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.playSection}>
                <View style={styles.playBar} />
                <Text style={styles.playText} numberOfLines={2} ellipsizeMode="tail">{currentItem.data.topPlay}</Text>
              </View>

              <View style={styles.playerSection}>
                <View style={styles.playerSectionHeaderWrap}>
                  <Text style={styles.playerSectionHeader}>{currentItem.data.playerSectionHeader || 'PLAYER OF THE GAME'}</Text>
                </View>
                <View style={styles.playerSectionBody}>
                   <Text style={styles.playerName}>{currentItem.data.playerGlance.name}</Text>
                   <Text style={styles.playerSubtext}>{currentItem.data.playerGlance.subtext}</Text>
                   <Text style={styles.playerStatsRow} numberOfLines={currentItem.data.playerSectionHeader === 'AT-BAT' ? 5 : 2} adjustsFontSizeToFit>{currentItem.data.playerGlance.stats}</Text>
                </View>
              </View>

              <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.4)' }]} />

            </View>
          )}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider style={{ backgroundColor: '#000000' }}>
      <TickerApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  wrapper: { 
    flex: 1, 
    backgroundColor: '#000000', 
    flexDirection: 'row',
    padding: 20
  },
  leftPanel: {
    flex: 0.35, 
    justifyContent: 'center',
    paddingRight: 20,
    paddingLeft: 10
  },
  rightPanel: {
    flex: 0.65, 
    justifyContent: 'center',
    alignItems: 'center',
  },
  clockContainer: {
    marginBottom: 30,
  },
  timeText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 2,
  },
  dateText: {
    color: '#EBEBF5',
    opacity: 0.8,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 5,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: '90%',
    marginBottom: 30,
  },
  infoContainer: {
    gap: 30,
  },
  infoBlock: {
    justifyContent: 'center',
  },
  infoLabel: {
    color: '#EBEBF5',
    opacity: 0.6,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '600',
  },
  alertBadge: {
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    borderColor: '#FF3B30',
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 10,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  alertText: {
    color: '#FF3B30',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  card: { 
    width: '100%', 
    maxWidth: 900, 
    borderRadius: 20, 
    overflow: 'hidden', 
    position: 'relative'
  },
  topSection: {
    padding: 20,
    paddingBottom: 15,
  },
  leagueText: {
    color: '#EBEBF5',
    opacity: 0.8,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 15,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  newsRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
    paddingVertical: 10
  },
  teamColLeft: {
    flex: 1,
    alignItems: 'flex-start'
  },
  teamColRight: {
    flex: 1,
    alignItems: 'flex-end'
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20
  },
  logoWrapper: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    backgroundColor: 'transparent'
  },
  teamLogo: {
    width: 48,
    height: 48,
  },
  scoreNum: {
    color: '#ffffff',
    fontFamily: 'SFShields',
    fontSize: 56,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  teamName: {
    color: '#EBEBF5',
    opacity: 0.9,
    fontSize: 18,
    marginTop: 8,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  teamNameRight: {
    color: '#EBEBF5',
    opacity: 0.9,
    fontSize: 18,
    marginTop: 8,
    fontWeight: '700',
    textAlign: 'right',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  teamRecord: {
    color: '#EBEBF5',
    opacity: 0.8,
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600'
  },
  teamRecordRight: {
    color: '#EBEBF5',
    opacity: 0.8,
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600',
    textAlign: 'right'
  },
  centerCol: {
    flex: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  basesContainer: {
    alignItems: 'center',
    marginBottom: 8,
  },
  basesRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: -4,
  },
  base: {
    width: 10,
    height: 10,
    backgroundColor: 'rgba(255,255,255,0.3)',
    transform: [{ rotate: '45deg' }],
  },
  baseActive: {
    backgroundColor: '#FFD700', 
  },
  baseTop: {
    marginBottom: 4,
  },
  mlbLiveStatus: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mlbCountText: {
    color: '#FFFFFF',
    opacity: 0.85,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  mlbInningText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 6,
  },
  centerStatusFallback: {
    alignItems: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
    opacity: 0.5
  },
  dot: {
    width: 4,
    height: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 2
  },
  statusText: {
    color: '#ffffff', 
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  playSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  playBar: {
    width: 3,
    height: 18,
    backgroundColor: '#FFFFFF', 
    opacity: 0.8,
    marginRight: 10,
    borderRadius: 2
  },
  playText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  playerSection: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)', 
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  playerSectionHeaderWrap: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)', 
    paddingVertical: 8,
  },
  playerSectionHeader: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 1
  },
  playerSectionBody: {
    padding: 15,
    paddingBottom: 20,
    alignItems: 'center'
  },
  playerName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4
  },
  playerSubtext: {
    color: '#EBEBF5',
    opacity: 0.8,
    fontSize: 14,
    marginBottom: 8,
    fontWeight: '500'
  },
  playerStatsRow: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 1,
    textAlign: 'center'
  },
  newsHeadline: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 34
  },
  progressBar: {
    height: 4,
    position: 'absolute',
    bottom: 0,
    left: 0,
    zIndex: 10,
  }
});