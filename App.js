import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Platform, Image, Animated, Easing } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'; 
import { useKeepAwake } from 'expo-keep-awake';
import { useFonts } from 'expo-font';

const fetchHeaders = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json, text/xml'
};

function TickerApp() {
  if (Platform.OS !== 'web') {
    useKeepAwake();
  }

  const [fontsLoaded] = useFonts({
    SFShields: require('./assets/Fonts/sf-display-shields-compressed-bold.otf'),
  });

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={styles.wrapper}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </SafeAreaView>
    );
  }

  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayCycle, setDisplayCycle] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [hebrewDate, setHebrewDate] = useState("");
  const [alertsCount, setAlertsCount] = useState(0);
  
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
    const fetchData = async () => {
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
                  homeAbbr: abbr, homeScore: '-', homeName: teamName,
                  homeLogo: `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr.toLowerCase()}.png`,
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
            
            if (events.length === 0 && teamJson.team?.nextEvent?.length > 0) {
                events = teamJson.team.nextEvent;
            }

            if (events.length === 0) return fallbackCard;
            
            let targetEvent = events.find(e => e?.competitions?.[0]?.status?.type?.state === 'in');
            if (!targetEvent) {
              const pastGames = events.filter(e => e?.competitions?.[0]?.status?.type?.state === 'post');
              targetEvent = pastGames.length > 0 ? pastGames[pastGames.length - 1] : events[0];
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

            const awayLogo = away.team.logo || `https://a.espncdn.com/i/teamlogos/${league}/500/${away.team.abbreviation.toLowerCase()}.png`;
            const homeLogo = home.team.logo || `https://a.espncdn.com/i/teamlogos/${league}/500/${home.team.abbreviation.toLowerCase()}.png`;
            
            const state = comp.status?.type?.state || targetEvent.status?.type?.state || 'pre';
            let statusText = String(targetEvent.status?.type?.detail || comp.status?.type?.detail || "Final");
            let situationObj = null;
            
            if (league === 'mlb' && state === 'in' && comp.situation) {
                const sit = comp.situation;
                situationObj = {
                    onFirst: !!sit.onFirst,
                    onSecond: !!sit.onSecond,
                    onThird: !!sit.onThird,
                };
                const balls = sit.balls || 0;
                const strikes = sit.strikes || 0;
                const outs = sit.outs || 0;
                
                statusText = statusText.replace('Bot ', '▼ ').replace('Top ', '▲ ').replace('Mid ', '▶ ').replace('End ', '◀ ');
                statusText += ` • ${balls}-${strikes} • ${outs} Out${outs !== 1 ? 's' : ''}`;
            }

            let topPlayText = "Game update available.";
            let leaderName = "Player Stats";
            let leaderStats = "Awaiting Data";
            let leaderSubtext = "Current Game Stats";

            if (state === 'in' && comp.situation?.lastPlay?.text) {
                topPlayText = comp.situation.lastPlay.text;
            } else if (comp.headlines && comp.headlines.length > 0) {
                topPlayText = comp.headlines[0].shortLinkText || comp.headlines[0].description;
            }

            try {
              const summaryRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${targetEvent.id}`, { headers: fetchHeaders });
              const summaryJson = await summaryRes.json();

              if (state === 'post' && summaryJson.article?.headline) {
                  topPlayText = summaryJson.article.headline;
              } else if (summaryJson.article?.headline && topPlayText === "Game update available.") {
                  topPlayText = summaryJson.article.headline;
              }
              
              if (league === 'mlb') {
                  if (state === 'in' && comp.situation?.batter) {
                      leaderName = comp.situation.batter.athlete.shortName || "Current Batter";
                      leaderStats = comp.situation.batter.summary || "At Bat";
                  } 
                  else if (summaryJson.boxscore?.players) {
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
                                      const name = a.athlete?.shortName || a.athlete?.displayName || "Player";
                                      const teamAbbr = teamBox.team?.abbreviation || "";
                                      
                                      leaderName = teamAbbr ? `${name} (${teamAbbr})` : name;
                                      leaderSubtext = `Season Avg: ${avg}`;
                                      leaderStats = `H/AB: ${hits}/${abs}  |  R: ${runs}  |  RBI: ${rbi}  |  HR: ${hr}`;
                                  }
                              });
                          }
                      });
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
            const myTeamDisplay = `${abbr}(${record})`;

            return {
              type: 'SPORTS',
              data: {
                league: league.toUpperCase(),
                date: dateText,
                awayAbbr: myTeamIsHome ? away.team.abbreviation : myTeamDisplay,
                awayScore: parseScore(away),
                awayName: away.team.name || away.team.shortDisplayName,
                awayLogo: awayLogo,
                homeAbbr: myTeamIsHome ? myTeamDisplay : home.team.abbreviation,
                homeScore: parseScore(home),
                homeName: home.team.name || home.team.shortDisplayName,
                homeLogo: homeLogo,
                status: statusText,
                situation: situationObj,
                topPlay: topPlayText,
                teamColor: myTeamColor,
                nextGame: { date: nextGameText, opponent: nextOpponent },
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
                const dateA = a.date_played || "";
                const dateB = b.date_played || "";
                return dateA.localeCompare(dateB);
            });

            let targetGame = myGames.find(g => String(g.status) === '2' || String(g.status) === 'In Progress');
            
            if (!targetGame) {
               const pastGames = myGames.filter(g => String(g.status) !== '1' && String(g.status) !== 'Scheduled');
               targetGame = pastGames.length > 0 ? pastGames[pastGames.length - 1] : myGames[0];
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
                awayAbbr: myTeamIsHome ? targetGame.visiting_team_code : myTeamDisplay,
                awayScore: targetGame.visiting_goal_count || "0",
                awayName: targetGame.visiting_team_name,
                awayLogo: `https://assets.leaguestat.com/pwhl/logos/50x50/${targetGame.visiting_team}.png`,
                homeAbbr: myTeamIsHome ? myTeamDisplay : targetGame.home_team_code,
                homeScore: targetGame.home_goal_count || "0",
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

        const sportsCards = [yankees, knicks, rangers, giants, sirens].filter(item => item && item.type !== 'ERROR' && item.data);
        
        // GROUP ALGORITHM: News first, then Sports
        let grouped = [];
        allNews.forEach(news => grouped.push({ type: 'NEWS', data: news }));
        sportsCards.forEach(sport => grouped.push(sport));

        setDisplayCycle(grouped);
        setLoading(false);

      } catch (e) {
        console.error("Critical failure building display:", e);
      }
    };

    fetchData();
    const dataInterval = setInterval(fetchData, 300000); 
    return () => clearInterval(dataInterval);
  }, []);

  useEffect(() => {
    if (displayCycle.length === 0) return;

    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 5000,
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
    }, 4700); // Trigger the fade 300ms before the 5s interval completes
    
    return () => clearTimeout(timer);
  }, [currentIndex, displayCycle.length]);

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
                <Text style={styles.infoLabel}>TZEVAH ADOM (24H)</Text>
                <View style={styles.alertBadge}>
                  <Text style={styles.alertText}>{alertsCount} ALERTS</Text>
                </View>
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
                            <Image source={{ uri: currentItem.data.awayLogo }} style={styles.teamLogo} resizeMode="contain" />
                         </View>
                      )}
                      <Text style={styles.scoreNum}>{currentItem.data.awayScore}</Text>
                    </View>
                    <Text style={styles.teamName}>{currentItem.data.awayAbbr}</Text>
                  </View>

                  {/* Center Status */}
                  <View style={styles.centerCol}>
                    {currentItem.data.league === 'MLB' && currentItem.data.situation ? (
                       <View style={styles.basesContainer}>
                         <View style={[styles.base, currentItem.data.situation.onSecond && styles.baseActive, styles.baseTop]} />
                         <View style={styles.basesRow}>
                           <View style={[styles.base, currentItem.data.situation.onThird && styles.baseActive]} />
                           <View style={[styles.base, currentItem.data.situation.onFirst && styles.baseActive]} />
                         </View>
                       </View>
                    ) : (
                       <View style={styles.dotsRow}>
                         <View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} />
                       </View>
                    )}
                    <Text style={[styles.statusText, currentItem.data.situation && { color: '#FFD700' }]}>
                      {currentItem.data.status}
                    </Text>
                  </View>

                  {/* Home Team */}
                  <View style={styles.teamColRight}>
                    <View style={styles.teamRow}>
                      <Text style={styles.scoreNum}>{currentItem.data.homeScore}</Text>
                      {currentItem.data.homeLogo && (
                         <View style={styles.logoWrapper}>
                            <Image source={{ uri: currentItem.data.homeLogo }} style={styles.teamLogo} resizeMode="contain" />
                         </View>
                      )}
                    </View>
                    <Text style={styles.teamNameRight}>{currentItem.data.homeAbbr}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.playSection}>
                <View style={styles.playBar} />
                <Text style={styles.playText} numberOfLines={2} ellipsizeMode="tail">{currentItem.data.topPlay}</Text>
              </View>

              <View style={styles.playerSection}>
                <View style={styles.playerSectionHeaderWrap}>
                  <Text style={styles.playerSectionHeader}>PLAYER OF THE GAME</Text>
                </View>
                <View style={styles.playerSectionBody}>
                   <Text style={styles.playerName}>{currentItem.data.playerGlance.name}</Text>
                   <Text style={styles.playerSubtext}>{currentItem.data.playerGlance.subtext}</Text>
                   <Text style={styles.playerStatsRow} numberOfLines={2} adjustsFontSizeToFit>{currentItem.data.playerGlance.stats}</Text>
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
    gap: 15
  },
  logoWrapper: {
    width: 52,
    height: 52,
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  teamLogo: {
    width: 36,
    height: 36,
  },
  scoreNum: {
    color: '#ffffff',
    fontFamily: 'SFShields',
    fontSize: 48,
    fontWeight: '800',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  teamName: {
    color: '#EBEBF5',
    opacity: 0.9,
    fontSize: 16,
    marginTop: 8,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  teamNameRight: {
    color: '#EBEBF5',
    opacity: 0.9,
    fontSize: 16,
    marginTop: 8,
    fontWeight: '700',
    textAlign: 'right',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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