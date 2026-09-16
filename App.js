import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Platform, Image, Animated, Easing, TouchableOpacity, TextInput, ScrollView, Switch, useWindowDimensions, KeyboardAvoidingView, Modal, Alert, AppState } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'; 
import { useKeepAwake } from 'expo-keep-awake';
import { useFonts } from 'expo-font';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set } from 'firebase/database';
import 'react-native-get-random-values'; // for uuid
import { v4 as uuidv4 } from 'uuid';

import {
  AVAILABLE_TEAMS,
  AVAILABLE_NEWS,
  AVAILABLE_SPECIAL_DEFINITIONS,
  AVAILABLE_SPECIAL,
  AVAILABLE_SCOREBOARDS,
  AVAILABLE_ESSENTIAL_CARDS,
  AVAILABLE_STANDINGS,
  ALL_AVAILABLE_ITEMS,
  FETCH_HEADERS as fetchHeaders,
  HAVDALAH_OFFSET_MINS,
  WEATHER_STALE_MS,
  GAME_OVER_ESTIMATE_MS,
  ANIMATION_DURATION_MS,
  ANIMATION_FADE_TRIGGER_MS
} from './constants';
import {
  isSameGame,
  isValidHeadline,
  getWeatherDescription,
  getWeatherBackground,
  getWeatherEmoji,
  cleanHtmlAndExtractText,
  splitRssItemIntoCards,
  parseEspnStandings,
  normalizeDivisionName,
  isZmanActive
} from './helpers';

// --- Magic Numbers Configs ---
const REFRESH_INTERVAL_MS = 300000;              // 5 Minutes

// --- Firebase Configuration ---
// IMPORTANT: Replace these with your own Firebase project credentials.
const firebaseConfig = {
  apiKey: "AIzaSyCXoDVmryclNRrkcbo2_quEtTPXMhHoG4s",
  authDomain: "shabbosmode-83043.firebaseapp.com",
  databaseURL: "https://shabbosmode-83043-default-rtdb.firebaseio.com",
  projectId: "shabbosmode-83043",
  storageBucket: "shabbosmode-83043.firebasestorage.app",
  messagingSenderId: "1071512338854",
  appId: "1:1071512338854:web:265ec0bc0b037ad4a70f67"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const formatLeagueName = (league) => {
  if (!league) return '';
  const lg = String(league).toUpperCase();
  if (lg === 'USA.1') return 'MLS';
  if (lg === 'ENG.1') return 'PREMIER LEAGUE';
  if (lg === 'FIFA.WORLD') return 'FIFA WORLD CUP';
  if (lg === 'COLLEGE-FOOTBALL' || lg === 'NCAAF') return 'NCAA FOOTBALL';
  if (lg === 'STANDINGS') return 'STANDINGS';
  if (lg === 'CLOCK' || lg === 'ZMANIM' || lg === 'PARSHA') return 'ESSENTIALS';
  return lg;
};

const parseRank = (competitor, teamObj) => {
  if (!competitor && !teamObj) return null;
  const candidates = [
    competitor?.curatedRank?.current,
    competitor?.rank,
    competitor?.team?.rank,
    competitor?.team?.curatedRank?.current,
    teamObj?.rank,
    teamObj?.curatedRank?.current
  ];
  for (const val of candidates) {
    if (val != null) {
      const num = parseInt(val, 10);
      if (num >= 1 && num <= 25) return num;
    }
  }
  return null;
};

const FIFA_WORLD_CUP_WINDOWS = [
  { start: new Date(2022, 10, 20), end: new Date(2022, 11, 18) }, // Nov 20 - Dec 18 2022
  { start: new Date(2026, 5, 11), end: new Date(2026, 6, 19) },   // Jun 11 - Jul 19 2026
];
const FIFA_WINDOW_OFFSET_MS = 14 * 24 * 60 * 60 * 1000;

const isFifaItem = (item) => {
  if (!item) return false;
  return item.league === 'fifa.world' || item.targetLeague === 'fifa.world';
};

const isWithinFifaWindow = (now = new Date()) => {
  return FIFA_WORLD_CUP_WINDOWS.some(({ start, end }) => {
    const windowStart = new Date(start.getTime() - FIFA_WINDOW_OFFSET_MS);
    const windowEnd = new Date(end.getTime() + FIFA_WINDOW_OFFSET_MS);
    return now >= windowStart && now <= windowEnd;
  });
};

const getSetupItems = (format = 'classic') => {
  const fifaAllowed = isWithinFifaWindow();
  return ALL_AVAILABLE_ITEMS.filter(item => {
    if (isFifaItem(item) && !fifaAllowed) {
      return false;
    }
    // In classic format, left panel permanently shows clock/zmanim so hide full-screen cards & standings
    if (format === 'classic') {
      if (item.league === 'clock' || item.league === 'zmanim' || item.league === 'parsha' || item.league === 'standings') {
        return false;
      }
    }
    return true;
  });
};

const sanitizePreferences = (prefs) => {
  const fifaAllowed = isWithinFifaWindow();
  const format = prefs?.format || 'classic';
  return {
    ...prefs,
    format,
    teams: (prefs?.teams || []).filter(team => {
      if (!team) return false;
      if (isFifaItem(team) && !fifaAllowed) return false;
      return true;
    }),
    zmanimLayout: prefs?.zmanimLayout || 'standard',
    lastUpdated: prefs?.lastUpdated || Date.now()
  };
};

const WeatherVisuals = ({ code, isDay }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const cloudAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 20000, // 20s loop for smooth background pacing
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(cloudAnim, {
        toValue: 1,
        duration: 100000, // Slower, more relaxed cloud drift
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [cloudAnim]);

  const isClear = [0, 1].includes(code);
  const isPartlyCloudy = [2, 45, 48].includes(code);
  const isOvercast = [3].includes(code);
  const isRainy = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code);
  const isStormy = [95, 96, 99].includes(code);
  const isSnowy = [71, 73, 75, 77, 85, 86].includes(code);

  if (isClear) {
    const spin = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    const transformStyle = isDay ? [{ rotate: spin }] : [];
    return (
      <View style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}>
        <Animated.Text style={{ position: 'absolute', top: -40, right: -40, fontSize: 180, opacity: 0.15, transform: transformStyle }}>{isDay ? '☀️' : '🌙'}</Animated.Text>
      </View>
    );
  }
  if (isPartlyCloudy || isOvercast) {
    // Create a 1600px continuous looping track for a tighter grouping
    const rightTravel = cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1600] });
    const leftTravel = cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [1600, 0] });

    // Use modulo math to offset each cloud so they start scattered ON the screen, but still loop seamlessly
    const move1 = Animated.add(Animated.modulo(Animated.add(rightTravel, 0), 1600), -400); 
    const move2 = Animated.add(Animated.modulo(Animated.add(leftTravel, 320), 1600), -400); 
    const move3 = Animated.add(Animated.modulo(Animated.add(rightTravel, 640), 1600), -400); 
    const move4 = Animated.add(Animated.modulo(Animated.add(leftTravel, 960), 1600), -400); 
    const move5 = Animated.add(Animated.modulo(Animated.add(rightTravel, 1280), 1600), -400); 
    
    // Extra clouds for overcast
    const move6 = Animated.add(Animated.modulo(Animated.add(leftTravel, 160), 1600), -400);
    const move7 = Animated.add(Animated.modulo(Animated.add(rightTravel, 480), 1600), -400);
    const move8 = Animated.add(Animated.modulo(Animated.add(leftTravel, 800), 1600), -400);
    const move9 = Animated.add(Animated.modulo(Animated.add(rightTravel, 1120), 1600), -400);
    const move10 = Animated.add(Animated.modulo(Animated.add(leftTravel, 1440), 1600), -400);

    const baseOpacity = isOvercast ? 0.35 : 0.15;
    const shadowStyle = isOvercast ? { textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 10, textShadowOffset: { width: 2, height: 2 } } : {};

    return (
      <View style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }, isOvercast && { backgroundColor: 'rgba(0,0,0,0.2)' }]}>
        <Animated.Text style={[{ position: 'absolute', top: -20, left: 0, fontSize: 240, opacity: baseOpacity, transform: [{ translateX: move1 }] }, shadowStyle]}>☁️</Animated.Text>
        <Animated.Text style={[{ position: 'absolute', top: 80, left: 0, fontSize: 280, opacity: baseOpacity - 0.05, transform: [{ translateX: move2 }] }, shadowStyle]}>☁️</Animated.Text>
        <Animated.Text style={[{ position: 'absolute', top: 180, left: 0, fontSize: 220, opacity: baseOpacity - 0.03, transform: [{ translateX: move3 }] }, shadowStyle]}>☁️</Animated.Text>
        <Animated.Text style={[{ position: 'absolute', top: -40, left: 0, fontSize: 320, opacity: baseOpacity - 0.01, transform: [{ translateX: move4 }] }, shadowStyle]}>☁️</Animated.Text>
        <Animated.Text style={[{ position: 'absolute', top: 140, left: 0, fontSize: 260, opacity: baseOpacity - 0.04, transform: [{ translateX: move5 }] }, shadowStyle]}>☁️</Animated.Text>
        {isOvercast && (
          <>
            <Animated.Text style={[{ position: 'absolute', top: 20, left: 0, fontSize: 300, opacity: 0.3, transform: [{ translateX: move6 }] }, shadowStyle]}>☁️</Animated.Text>
            <Animated.Text style={[{ position: 'absolute', top: 120, left: 0, fontSize: 250, opacity: 0.25, transform: [{ translateX: move7 }] }, shadowStyle]}>☁️</Animated.Text>
            <Animated.Text style={[{ position: 'absolute', top: -50, left: 0, fontSize: 270, opacity: 0.35, transform: [{ translateX: move8 }] }, shadowStyle]}>☁️</Animated.Text>
            <Animated.Text style={[{ position: 'absolute', top: 200, left: 0, fontSize: 290, opacity: 0.28, transform: [{ translateX: move9 }] }, shadowStyle]}>☁️</Animated.Text>
            <Animated.Text style={[{ position: 'absolute', top: 60, left: 0, fontSize: 310, opacity: 0.32, transform: [{ translateX: move10 }] }, shadowStyle]}>☁️</Animated.Text>
          </>
        )}
      </View>
    );
  }
  if (isRainy || isStormy) {
    const fall = anim.interpolate({ inputRange: [0, 1], outputRange: [-200, 4000] });
    const fall2 = anim.interpolate({ inputRange: [0, 1], outputRange: [-1000, 3200] });
    return (
      <View style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}>
        <Animated.Text style={{ position: 'absolute', left: '15%', top: 0, fontSize: 60, opacity: 0.3, transform: [{ translateY: fall }, { rotate: '10deg' }] }}>💧</Animated.Text>
        <Animated.Text style={{ position: 'absolute', left: '45%', top: 0, fontSize: 50, opacity: 0.2, transform: [{ translateY: fall2 }, { rotate: '10deg' }] }}>💧</Animated.Text>
        <Animated.Text style={{ position: 'absolute', left: '75%', top: 0, fontSize: 70, opacity: 0.3, transform: [{ translateY: fall }, { rotate: '10deg' }] }}>💧</Animated.Text>
        {isStormy && <Animated.Text style={{ position: 'absolute', left: '50%', top: 40, fontSize: 120, opacity: 0.2 }}>⚡</Animated.Text>}
      </View>
    );
  }
  if (isSnowy) {
    const fallSlow = anim.interpolate({ inputRange: [0, 1], outputRange: [-100, 1000] });
    const fallSlow2 = anim.interpolate({ inputRange: [0, 1], outputRange: [-500, 600] });
    const spin = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
    return (
      <View style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}>
        <Animated.Text style={{ position: 'absolute', left: '20%', top: 0, fontSize: 40, opacity: 0.3, transform: [{ translateY: fallSlow }, { rotate: spin }] }}>❄️</Animated.Text>
        <Animated.Text style={{ position: 'absolute', left: '60%', top: 0, fontSize: 50, opacity: 0.2, transform: [{ translateY: fallSlow2 }, { rotate: spin }] }}>❄️</Animated.Text>
        <Animated.Text style={{ position: 'absolute', left: '85%', top: 0, fontSize: 35, opacity: 0.3, transform: [{ translateY: fallSlow }, { rotate: spin }] }}>❄️</Animated.Text>
      </View>
    );
  }
  return null;
};

const ClockCard = ({ currentTime, hebrewDate, locationName, sunsetTime, isTablet, isCards, cardMaxWidth, interpolatedWidth }) => {
  const timeString = currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ampm = currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).slice(-2);
  const dateString = currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeOnly = timeString.replace(/\s*(AM|PM)/i, '');

  return (
    <LinearGradient 
      colors={['#0F172A', '#1E293B', '#0B1329']} 
      style={[
        styles.card, 
        styles.clockCardFull, 
        { maxWidth: cardMaxWidth },
        isCards && { flex: 1, width: '100%', maxHeight: '100%', padding: isTablet ? 28 : 14, justifyContent: 'space-between' }
      ]}
    >
      <View style={[styles.clockCardContent, isCards && { flex: 1, justifyContent: 'space-evenly' }]}>
        <View style={styles.clockCardTopRow}>
          <Text style={[styles.clockLocationBadge, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 24 : 16 }]}>📍 {locationName || 'Local'}</Text>
          {sunsetTime && (
            <Text style={[styles.clockSunsetBadge, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 24 : 16 }]}>
              🌅 Sunset: {sunsetTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </Text>
          )}
        </View>

        <View style={[styles.clockBigDisplay, isCards && { marginVertical: isTablet ? 12 : 4 }]}>
          <Text 
            style={[
              styles.clockBigTime, 
              isTablet && { fontSize: 130 },
              isCards && { fontSize: isTablet ? 180 : 104, fontWeight: '900' }
            ]} 
            adjustsFontSizeToFit 
            numberOfLines={1}
          >
            {timeOnly}
            <Text style={[styles.clockAmPm, isTablet && { fontSize: 44 }, isCards && { fontSize: isTablet ? 56 : 34 }]}> {ampm}</Text>
          </Text>
        </View>

        <Text style={[styles.clockBigDate, isTablet && { fontSize: 26 }, isCards && { fontSize: isTablet ? 34 : 22, marginBottom: isTablet ? 8 : 4 }]}>{dateString}</Text>

        <View style={[styles.clockDivider, isCards && { width: '90%', marginVertical: isTablet ? 14 : 6 }]} />

        <View style={styles.clockHebrewContainer}>
          <Text style={[styles.clockHebrewLabel, isTablet && { fontSize: 14 }, isCards && { fontSize: isTablet ? 16 : 13 }]}>HEBREW DATE</Text>
          <Text style={[styles.clockHebrewDate, isTablet && { fontSize: 30 }, isCards && { fontSize: isTablet ? 44 : 30 }]}>{hebrewDate || 'Loading...'}</Text>
        </View>
      </View>
      <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(10, 132, 255, 0.6)' }]} />
    </LinearGradient>
  );
};

const ZmanimCard = ({ 
  data, 
  upcomingZmanim = [], 
  fullZmanimTable = [], 
  sunsetTime, 
  locationName: propLocationName, 
  isTablet, 
  isCards, 
  cardMaxWidth, 
  interpolatedWidth 
}) => {
  const locName = propLocationName || data?.locationName || 'LOCAL';

  let candleLighting = null;
  let havdallah = null;
  let havdallah72 = data?.havdallah72;

  // Prefer live active upcomingZmanim so current times are always prioritized
  (upcomingZmanim || []).forEach(z => {
    if (!candleLighting && (z.label.includes('CANDLE') || z.label.includes('LIGHTING'))) candleLighting = z.time;
    if (!havdallah && z.label.includes('HAVDALAH')) havdallah = z.time;
  });

  // Fall back to card data if not in active upcomingZmanim
  if (!candleLighting) candleLighting = data?.candleLighting;
  if (!havdallah) havdallah = data?.havdallah;

  // Fall back to live sunsetTime for 72 min
  if (!havdallah72 && sunsetTime) {
    try {
      const d72 = new Date(new Date(sunsetTime).getTime() + 72 * 60 * 1000);
      havdallah72 = d72.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (e) {}
  }

  // Determine halachic times list
  let zmanimList = [];
  if (fullZmanimTable && fullZmanimTable.length > 0) {
    zmanimList = fullZmanimTable;
  } else if (data?.zmanimList && data.zmanimList.length > 0) {
    zmanimList = data.zmanimList;
  } else if (upcomingZmanim && upcomingZmanim.length > 0) {
    zmanimList = upcomingZmanim;
  }

  // If still empty but we have sunsetTime, candleLighting, havdallah, construct a list
  if (zmanimList.length === 0) {
    if (candleLighting) zmanimList.push({ label: 'Candle Lighting', time: candleLighting });
    if (sunsetTime) {
      zmanimList.push({ 
        label: 'Shkiah (Sunset)', 
        time: new Date(sunsetTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) 
      });
    }
    if (havdallah) zmanimList.push({ label: 'Havdalah', time: havdallah });
    if (havdallah72) zmanimList.push({ label: 'Tzais (72 Min)', time: havdallah72 });
  }

  return (
    <View style={[
      styles.card, 
      styles.zmanimCardFull, 
      { maxWidth: cardMaxWidth },
      isCards && { flex: 1, width: '100%', maxHeight: '100%', padding: isTablet ? 24 : 12, justifyContent: 'space-between' }
    ]}>
      <View style={[styles.topSection, { padding: 0 }, isCards && { flex: 1, justifyContent: 'space-between' }]}>
        <Text style={[styles.leagueText, isTablet && { fontSize: 18, marginBottom: 15 }, isCards && { fontSize: isTablet ? 22 : 15, marginBottom: isTablet ? 12 : 6 }]}>
          SHABBOS & DAILY ZMANIM • {String(locName).toUpperCase()}
        </Text>

        {/* Top Spotlight: Candles & Havdalah */}
        <View style={[styles.zmanimSpotlightRow, isCards && { marginBottom: isTablet ? 14 : 6 }]}>
          <View style={[styles.zmanimSpotlightBox, { borderColor: '#FFA500' }, isCards && { padding: isTablet ? 18 : 8 }]}>
            <Text style={[styles.zmanimSpotlightIcon, isTablet && { fontSize: 32 }, isCards && { fontSize: isTablet ? 42 : 26 }]}>🕯️</Text>
            <Text style={[styles.zmanimSpotlightLabel, isTablet && { fontSize: 14 }, isCards && { fontSize: isTablet ? 16 : 12, letterSpacing: 1.5, marginBottom: 2 }]}>CANDLE LIGHTING</Text>
            <Text style={[styles.zmanimSpotlightTime, isTablet && { fontSize: 36 }, isCards && { fontSize: isTablet ? 56 : 32, fontWeight: '900' }]} adjustsFontSizeToFit numberOfLines={1}>{candleLighting || '--:--'}</Text>
          </View>
          <View style={[styles.zmanimSpotlightBox, { borderColor: '#AF52DE' }, isCards && { padding: isTablet ? 18 : 8 }]}>
            <Text style={[styles.zmanimSpotlightIcon, isTablet && { fontSize: 32 }, isCards && { fontSize: isTablet ? 42 : 26 }]}>🍷</Text>
            <Text style={[styles.zmanimSpotlightLabel, isTablet && { fontSize: 14 }, isCards && { fontSize: isTablet ? 16 : 12, letterSpacing: 1.5, marginBottom: 2 }]}>HAVDALAH</Text>
            <Text style={[styles.zmanimSpotlightTime, isTablet && { fontSize: 36 }, isCards && { fontSize: isTablet ? 56 : 32, fontWeight: '900' }]} adjustsFontSizeToFit numberOfLines={1}>{havdallah || '--:--'}</Text>
            {havdallah72 && (
              <Text style={[styles.zmanimSpotlightSubtext, isTablet && { fontSize: 15 }, isCards && { fontSize: isTablet ? 18 : 13, marginTop: 2 }]}>72 Min: {havdallah72}</Text>
            )}
          </View>
        </View>

        {/* Halachic Daily Times Grid */}
        {zmanimList && zmanimList.length > 0 && (
          <View style={[styles.zmanimGridContainer, isCards && { flex: 1, justifyContent: 'center', padding: isTablet ? 12 : 6 }]}>
            <Text style={[styles.zmanimGridHeader, isTablet && { fontSize: 14 }, isCards && { fontSize: isTablet ? 16 : 12, letterSpacing: 1.5, marginBottom: isTablet ? 8 : 4 }]}>TODAY'S HALACHIC TIMES</Text>
            <View style={[styles.zmanimGrid, isCards && { gap: isTablet ? 8 : 4 }]}>
              {zmanimList.map((z, idx) => (
                <View key={idx} style={[
                  styles.zmanimGridItem, 
                  isTablet && { width: '31.5%' },
                  isCards && (
                    isTablet 
                      ? { width: '19.2%', paddingVertical: 10, paddingHorizontal: 6 } 
                      : { width: '23.8%', paddingVertical: 6, paddingHorizontal: 4 }
                  )
                ]}>
                  <Text style={[styles.zmanimItemLabel, isTablet && { fontSize: 13 }, isCards && { fontSize: isTablet ? 14 : 11 }]} numberOfLines={1}>{z.label}</Text>
                  <Text style={[styles.zmanimItemTime, isTablet && { fontSize: 20 }, isCards && { fontSize: isTablet ? 24 : 15, fontWeight: '800' }]}>{z.time}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
      <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 165, 0, 0.5)' }]} />
    </View>
  );
};

const StandingsCard = ({ data, isTablet, isCards, cardMaxWidth, interpolatedWidth }) => {
  const { league, divisionName, entries = [], logo, headerText } = data || {};
  const isHockey = String(league).toLowerCase().includes('nhl') || String(league).toLowerCase().includes('pwhl');
  const isSoccer = String(league).toLowerCase().includes('mls') || String(league).toLowerCase().includes('usa.1') || String(league).toLowerCase().includes('eng.1') || String(league).toLowerCase().includes('premier');

  const maxEntries = isTablet ? (isCards ? 10 : 8) : 5;
  const displayedEntries = (entries || []).slice(0, maxEntries);

  return (
    <View style={[
      styles.card, 
      styles.standingsCardFull, 
      { maxWidth: cardMaxWidth },
      isCards && { flex: 1, width: '100%', maxHeight: '100%', padding: isTablet ? 24 : 12, justifyContent: 'space-between' }
    ]}>
      <View style={[styles.topSection, { padding: 0 }, isCards && { flex: 1 }]}>
        <View style={[styles.standingsHeaderRow, isCards && { marginBottom: isTablet ? 12 : 6 }]}>
          {logo ? (
            <Image source={{ uri: logo }} style={[styles.standingsHeaderLogo, isCards && isTablet && { width: 42, height: 42 }]} resizeMode="contain" />
          ) : null}
          <Text style={[styles.leagueText, isTablet && { fontSize: 20, marginBottom: 0 }, isCards && { fontSize: isTablet ? 24 : 16, marginBottom: 0 }]} numberOfLines={1}>
            {headerText || `${formatLeagueName(league)} • ${(divisionName || '').toUpperCase()} STANDINGS`}
          </Text>
        </View>

        {/* Table Header */}
        <View style={[styles.standingsTableHeader, isCards && { paddingVertical: isTablet ? 10 : 5 }]}>
          <Text style={[styles.stHeaderCol, { width: isCards && isTablet ? 44 : 30, textAlign: 'center' }, isCards && { fontSize: isTablet ? 16 : 12 }]}>#</Text>
          <Text style={[styles.stHeaderCol, { flex: 1, textAlign: 'left', paddingLeft: 8 }, isCards && { fontSize: isTablet ? 16 : 12 }]}>TEAM</Text>
          <Text style={[styles.stHeaderCol, { width: isCards && isTablet ? 65 : 42, textAlign: 'right' }, isCards && { fontSize: isTablet ? 16 : 12 }]}>W</Text>
          <Text style={[styles.stHeaderCol, { width: isCards && isTablet ? 65 : 42, textAlign: 'right' }, isCards && { fontSize: isTablet ? 16 : 12 }]}>L</Text>
          {isHockey || isSoccer ? (
            <Text style={[styles.stHeaderCol, { width: isCards && isTablet ? 70 : 45, textAlign: 'right' }, isCards && { fontSize: isTablet ? 16 : 12 }]}>PTS</Text>
          ) : (
            <Text style={[styles.stHeaderCol, { width: isCards && isTablet ? 70 : 45, textAlign: 'right' }, isCards && { fontSize: isTablet ? 16 : 12 }]}>PCT</Text>
          )}
          <Text style={[styles.stHeaderCol, { width: isCards && isTablet ? 65 : 42, textAlign: 'right' }, isCards && { fontSize: isTablet ? 16 : 12 }]}>GB</Text>
          {isTablet && <Text style={[styles.stHeaderCol, { width: isCards ? 70 : 55, textAlign: 'right' }, isCards && { fontSize: 16 }]}>STRK</Text>}
        </View>

        {/* Table Rows */}
        <View style={[styles.standingsRowsContainer, isCards && { flex: 1, justifyContent: 'space-evenly' }]}>
          {displayedEntries.map((team, idx) => {
            const isLeader = idx === 0;

            return (
              <View 
                key={team.id || idx} 
                style={[
                  styles.standingsRow,
                  isLeader && styles.standingsRowLeader,
                  isTablet && { paddingVertical: 8 },
                  isCards && { paddingVertical: isTablet ? (displayedEntries.length > 7 ? 5 : 8) : 3 }
                ]}
              >
                <Text style={[styles.stCellRank, isLeader && { color: '#FFD700' }, isCards && { width: isTablet ? 44 : 30, fontSize: isTablet ? 18 : 13 }]}>
                  {team.rank || idx + 1}
                </Text>
                
                <View style={styles.stCellTeam}>
                  {team.logo && (
                    <Image source={{ uri: team.logo }} style={[styles.stTeamLogo, isCards && { width: isTablet ? 32 : 20, height: isTablet ? 32 : 20 }]} resizeMode="contain" />
                  )}
                  <Text style={[styles.stTeamName, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 20 : 14 }]} numberOfLines={1}>
                    {isTablet ? team.name : team.abbr}
                  </Text>
                </View>

                <Text style={[styles.stCellStat, isTablet && { fontSize: 18 }, isCards && { width: isTablet ? 65 : 42, fontSize: isTablet ? 18 : 13 }]}>{team.wins}</Text>
                <Text style={[styles.stCellStat, isTablet && { fontSize: 18 }, isCards && { width: isTablet ? 65 : 42, fontSize: isTablet ? 18 : 13 }]}>{team.losses}</Text>
                <Text style={[styles.stCellStat, isTablet && { fontSize: 18 }, isCards && { width: isTablet ? 70 : 45, fontSize: isTablet ? 18 : 13 }]}>
                  {isHockey || isSoccer ? (team.points ?? team.record?.split('-')[2] ?? '-') : (team.winPct || '-')}
                </Text>
                <Text style={[styles.stCellStat, { opacity: team.gb === '-' ? 0.6 : 0.9 }, isTablet && { fontSize: 18 }, isCards && { width: isTablet ? 65 : 42, fontSize: isTablet ? 18 : 13 }]}>{team.gb}</Text>
                {isTablet && (
                  <Text style={[styles.stCellStat, { color: team.streak?.startsWith('W') ? '#30D158' : team.streak?.startsWith('L') ? '#FF453A' : '#EBEBF5', fontSize: isCards ? 18 : 18 }, isCards && { width: 70 }]}>
                    {team.streak || '-'}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </View>
      <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.4)' }]} />
    </View>
  );
};

const ParshaCard = ({ 
  data, 
  parshaInfo, 
  upcomingZmanim = [], 
  isTablet, 
  isCards, 
  cardMaxWidth, 
  interpolatedWidth 
}) => {
  const pName = (parshaInfo?.parshaName && parshaInfo.parshaName !== 'Weekly Parsha')
    ? parshaInfo.parshaName
    : (data?.parshaName && data.parshaName !== 'Weekly Parsha' ? data.parshaName : (parshaInfo?.parshaName || 'Weekly Parsha'));

  const pHebrew = (parshaInfo?.parshaHebrew && parshaInfo.parshaHebrew !== 'פרשת השבוע')
    ? parshaInfo.parshaHebrew
    : (data?.parshaHebrew && data.parshaHebrew !== 'פרשת השבוע' ? data.parshaHebrew : (parshaInfo?.parshaHebrew || 'פרשת השבוע'));

  const pHaftarah = parshaInfo?.haftarah || data?.haftarah || null;
  const pDate = parshaInfo?.date 
    ? `SHABBAT • ${new Date(parshaInfo.date + (parshaInfo.date.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}`
    : (data?.date && data.date !== 'SHABBAT' ? data.date : 'SHABBAT');

  // Match ZmanimCard candle lighting logic:
  // First check live upcoming active candle lighting (first active candle lighting), matching ZmanimCard
  let pCandle = null;
  (upcomingZmanim || []).forEach(z => {
    if (!pCandle && (z.label.includes('CANDLE') || z.label.includes('LIGHTING'))) pCandle = z.time;
  });
  if (!pCandle) {
    pCandle = data?.candleLighting || parshaInfo?.candleLighting || null;
  }

  return (
    <LinearGradient 
      colors={['#1A1A2E', '#16213E', '#0F3460']} 
      style={[
        styles.card, 
        styles.parshaCardFull, 
        { maxWidth: cardMaxWidth },
        isCards && { flex: 1, width: '100%', maxHeight: '100%', padding: isTablet ? 28 : 14, justifyContent: 'space-between' }
      ]}
    >
      <View style={[styles.topSection, { padding: 0 }, isCards && { flex: 1, justifyContent: 'space-between' }]}>
        <Text style={[styles.leagueText, isTablet && { fontSize: 18, marginBottom: 15 }, isCards && { fontSize: isTablet ? 22 : 15, marginBottom: isTablet ? 12 : 6 }]}>
          TORAH PORTION OF THE WEEK • {pDate}
        </Text>

        <View style={[styles.parshaCenterContent, isCards && { flex: 1, justifyContent: 'space-evenly' }]}>
          <Text style={[styles.parshaShabbatGreeting, isTablet && { fontSize: 32 }, isCards && { fontSize: isTablet ? 50 : 28, marginBottom: isTablet ? 4 : 2 }]}>שַׁבָּת שָׁלוֹם</Text>
          <Text style={[styles.parshaHebrewName, isTablet && { fontSize: 44 }, isCards && { fontSize: isTablet ? 66 : 38, marginBottom: isTablet ? 4 : 2 }]}>{pHebrew}</Text>
          <Text style={[styles.parshaEnglishName, isTablet && { fontSize: 32 }, isCards && { fontSize: isTablet ? 42 : 26, marginBottom: isTablet ? 10 : 4 }]}>{pName}</Text>
          
          {pHaftarah ? (
            <View style={[styles.haftarahContainer, isCards && { paddingVertical: isTablet ? 10 : 5, paddingHorizontal: isTablet ? 20 : 12, maxWidth: 750, marginBottom: isTablet ? 10 : 4 }]}>
              <Text style={[styles.haftarahLabel, isTablet && { fontSize: 14 }, isCards && { fontSize: isTablet ? 16 : 12 }]}>HAFTARAH</Text>
              <Text style={[styles.haftarahText, isTablet && { fontSize: 20 }, isCards && { fontSize: isTablet ? 24 : 16 }]}>{pHaftarah}</Text>
            </View>
          ) : null}

          {pCandle ? (
            <View style={[styles.parshaCandleBadge, isCards && { paddingVertical: isTablet ? 10 : 5, paddingHorizontal: isTablet ? 20 : 12, borderRadius: 22 }]}>
              <Text style={[styles.parshaCandleText, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 24 : 16 }]}>🕯️ Candle Lighting: {pCandle}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 215, 0, 0.5)' }]} />
    </LinearGradient>
  );
};


function FormatSelectScreen({ currentFormat, onSelectFormat, onBack }) {
  const [selectedFormat, setSelectedFormat] = useState(currentFormat || 'classic');

  return (
    <SafeAreaView style={styles.settingsWrapper}>
      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 20 }} style={{ width: '100%', maxWidth: 750 }}>
        <Text style={styles.formatSelectHeader}>Choose Ticker Format</Text>
        <Text style={styles.formatSelectSubheader}>
          Select your preferred display format before customizing items.
        </Text>

        <View style={styles.formatCardsContainer}>
          {/* Classic Format */}
          <TouchableOpacity 
            style={[styles.formatCard, selectedFormat === 'classic' && styles.formatCardActive]}
            onPress={() => setSelectedFormat('classic')}
            activeOpacity={0.8}
          >
            <View style={styles.formatBadge}>
              <Text style={styles.formatBadgeText}>ORIGINAL DASHBOARD</Text>
            </View>
            <Text style={styles.formatCardTitle}>Classic</Text>
            <Text style={styles.formatCardDescription}>
              2-section structure. Left ~1/3 shows the persistent clock, Hebrew date, and zmanim. Right ~2/3 cycles through sports, news, and weather cards.
            </Text>
            
            {/* Visual Preview */}
            <View style={styles.formatPreviewBox}>
              <View style={styles.formatPreviewLeft}>
                <Text style={styles.previewMiniClock}>12:45</Text>
                <Text style={styles.previewMiniSub}>Hebrew Date</Text>
                <Text style={styles.previewMiniSub}>Zmanim</Text>
              </View>
              <View style={styles.formatPreviewRight}>
                <Text style={styles.previewMiniCard}>🏈 Sports / ☀️ Weather</Text>
              </View>
            </View>

            <View style={[styles.formatSelectRadio, selectedFormat === 'classic' && styles.formatSelectRadioActive]}>
              <Text style={styles.formatSelectRadioText}>{selectedFormat === 'classic' ? '✓ Selected' : 'Select Classic'}</Text>
            </View>
          </TouchableOpacity>

          {/* Cards Format */}
          <TouchableOpacity 
            style={[styles.formatCard, selectedFormat === 'cards' && styles.formatCardActive]}
            onPress={() => setSelectedFormat('cards')}
            activeOpacity={0.8}
          >
            <View style={[styles.formatBadge, { backgroundColor: '#FF9500' }]}>
              <Text style={styles.formatBadgeText}>NEW FULL-SCREEN</Text>
            </View>
            <Text style={styles.formatCardTitle}>Cards</Text>
            <Text style={styles.formatCardDescription}>
              Cards expand to take up the entire screen. Includes dedicated full-screen cards for Clock & Date, Shabbos Zmanim, and Division Standings.
            </Text>

            {/* Visual Preview */}
            <View style={styles.formatPreviewBox}>
              <View style={styles.formatPreviewFull}>
                <Text style={styles.previewMiniCardFull}>🎴 Full-Screen Cards (Sports, Clock, Zmanim, Standings)</Text>
              </View>
            </View>

            <View style={[styles.formatSelectRadio, selectedFormat === 'cards' && styles.formatSelectRadioActive]}>
              <Text style={styles.formatSelectRadioText}>{selectedFormat === 'cards' ? '✓ Selected' : 'Select Cards'}</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.primaryButtonSettings} 
          onPress={() => onSelectFormat(selectedFormat)}
        >
          <Text style={styles.primaryButtonText}>Continue to Setup ({selectedFormat === 'cards' ? 'Cards' : 'Classic'}) →</Text>
        </TouchableOpacity>

        {onBack && (
          <TouchableOpacity style={[styles.secondaryButtonSettings, { borderColor: 'transparent' }]} onPress={onBack}>
            <Text style={[styles.secondaryButtonText, { opacity: 0.7 }]}>Back</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TickerApp({ preferences, layoutMode, onSetup }) {
  useKeepAwake();

  const [fontsLoaded] = useFonts({
    SFShields: require('./assets/Fonts/sf-display-shields-compressed-bold.otf'),
  });

  const { width: windowWidth } = useWindowDimensions();
  const isSmallDevice = windowWidth < 700;
  const isTablet = windowWidth >= 1000;

  const pwhlCache = useRef({ games: [], standings: [], lastFetch: 0 });

  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayCycle, setDisplayCycle] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingError, setLoadingError] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [hebrewDate, setHebrewDate] = useState("");
  const [alertsCount, setAlertsCount] = useState(0);
  const [upcomingZmanim, setUpcomingZmanim] = useState([]);
  const [allZmanim, setAllZmanim] = useState([]);
  const [fullZmanimTable, setFullZmanimTable] = useState([]);
  const [parshaInfo, setParshaInfo] = useState(null);
  const [locationCoords, setLocationCoords] = useState(null);
  const [locationName, setLocationName] = useState('Local');
  const [timeZone, setTimeZone] = useState(null);
  const effectiveTz = timeZone || (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'America/New_York');
  const [sunsetTime, setSunsetTime] = useState(null);
  const [effectiveDateString, setEffectiveDateString] = useState("");
  const [showSetupButton, setShowSetupButton] = useState(true);
  const [setupCountdown, setSetupCountdown] = useState(15);
  const computeHavdalahRef = useRef(null);
  const lastFetchedDateRef = useRef('');
  
  useEffect(() => {
    if (setupCountdown > 0) {
      const timer = setTimeout(() => setSetupCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setShowSetupButton(false);
    }
  }, [setupCountdown]);

  // Animation value for the progress bar
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnimLeft = useRef(new Animated.Value(1)).current;
  const fadeAnimRight = useRef(new Animated.Value(1)).current;
  const indicatorScrollRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setAlertsCount(Math.floor(Math.random() * 3));
  }, []);

  useEffect(() => {
    let d = new Date(currentTime);
    
    if (sunsetTime) {
      const isSameDay = d.getDate() === sunsetTime.getDate() && 
                        d.getMonth() === sunsetTime.getMonth() && 
                        d.getFullYear() === sunsetTime.getFullYear();
                        
      if (isSameDay) {
        if (d >= sunsetTime) {
          d.setDate(d.getDate() + 1);
        }
      } else {
        // Fallback if we failed to get today's sunset (e.g., background GPS paused on Shabbos)
        if (d.getHours() >= 19) {
          d.setDate(d.getDate() + 1);
        }
      }
    } else {
      if (d.getHours() >= 19) {
        d.setDate(d.getDate() + 1);
      }
    }

    const dString = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    if (dString !== effectiveDateString) {
      setEffectiveDateString(dString);
    }
  }, [currentTime, sunsetTime, effectiveDateString]);

  useEffect(() => {
    if (!effectiveDateString) return;

    const converterUrl = timeZone ? `https://www.hebcal.com/converter?cfg=json&date=${effectiveDateString}&g2h=1&strict=1&tzid=${timeZone}` : `https://www.hebcal.com/converter?cfg=json&date=${effectiveDateString}&g2h=1&strict=1`;

    fetch(converterUrl, { headers: fetchHeaders })
      .then(res => res.json())
      .then(data => {
        let dateStr = "";
        if (data.hd && data.hm && data.hy) {
            dateStr = `${data.hd} ${data.hm} ${data.hy}`;
        } else if (data.hebrew) {
            dateStr = data.hebrew;
        }
        
        fetch(`https://www.hebcal.com/hebcal?v=1&cfg=json&start=${effectiveDateString}&end=${effectiveDateString}&o=on`)
                .then(r => r.json())
                .then(omerData => {
                    if (omerData.items) {
                          const isShavuot = omerData.items.some(item => item.category === 'holiday' && item.title.includes('Shavuot'));
                        const omerEvent = omerData.items.find(item => item.category === 'omer');
                          if (omerEvent && !isShavuot) {
                            dateStr += `\n${omerEvent.title}`;
                        }
                    }
                    setHebrewDate(dateStr || "Data Unavailable");
                })
                .catch(() => setHebrewDate(dateStr || "Data Unavailable")); 
      })
      .catch(err => {
        setHebrewDate("Fetch Failed");
      });
  }, [effectiveDateString]);

  useEffect(() => {
    let cancelled = false;

    const computeHavdalah = async () => {
      computeHavdalahRef.current = computeHavdalah;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setAllZmanim([]);
          setUpcomingZmanim([]);
          return;
        }

        const loc = await Location.getCurrentPositionAsync({});
        const lat = loc.coords.latitude;
        const lon = loc.coords.longitude;
        let placeName = locationName || 'Local';
        if (!cancelled) {
          setLocationCoords({ latitude: lat, longitude: lon });
          try {
            const reverse = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
            if (reverse?.length) {
              const place = reverse[0];
              placeName = place.city || place.region || place.subregion || place.country || 'Local';
              setLocationName(placeName);
            }
          } catch (geocodeErr) {
            // ignore reverse geocode failures
          }
        }

        const targetDate = new Date();
        const dateStr = targetDate.getFullYear() + "-" + String(targetDate.getMonth() + 1).padStart(2, '0') + "-" + String(targetDate.getDate()).padStart(2, '0');
        lastFetchedDateRef.current = dateStr;

        let havFetched = false;
        let fetchedSunsetDate = null;

        // 1. Fetch exact sunset for Hebrew date calculation
        try {
          const sunRes = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lon}&date=${dateStr}&formatted=0`);
          if (sunRes.ok) {
            const sunJson = await sunRes.json();
            const sunsetIso = sunJson.results?.sunset;
            if (sunsetIso) {
              fetchedSunsetDate = new Date(sunsetIso);
              if (!cancelled) setSunsetTime(fetchedSunsetDate);
            }
          }
        } catch (e) {
        }

        // 2. Fetch Zmanim (Candles & Havdalah & Parsha) from Hebcal
        const hebcalUrl = `https://www.hebcal.com/shabbat/?cfg=json&latitude=${lat}&longitude=${lon}&date=${dateStr}&M=on&tzid=${effectiveTz}`;
        const zmanim = [];
        let fetchedParsha = null;
        try {
          const hres = await fetch(hebcalUrl, { headers: fetchHeaders });
          if (hres.ok) {
            const hjson = await hres.json();
            const items = hjson.items || [];
            
            const nowMs = new Date().getTime();
            
            items.forEach(i => {
                if (i.category === 'parashat') {
                    fetchedParsha = {
                        parshaName: i.title,
                        parshaHebrew: i.hebrew,
                        haftarah: i.leyning?.haftarah || i.haftarah || null,
                        date: i.date,
                        link: i.link
                    };
                }
                if (i.category === 'candles' || i.category === 'havdalah') {
                    const d = new Date(i.date);
                    // Do not expire until midnight local time (11:59:59 PM) of the day on which it occurs
                    if (isZmanActive(d, nowMs, effectiveTz)) {
                        let label = i.category === 'candles' ? 'CANDLES' : 'HAVDALAH';
                        if (i.memo) {
                            // Normalize memo texts for Chagim
                            let cleanMemo = i.memo.replace(/Parashat [a-zA-Z\-]+/i, 'Shabbos')
                                                  .replace(/ I$/g, ' Day 1')
                                                  .replace(/ II$/g, ' Day 2')
                                                  .replace(/ III$/g, ' Day 3')
                                                  .replace(/ IV$/g, ' Day 4')
                                                  .replace(/ V$/g, ' Day 5')
                                                  .replace(/ VI$/g, ' Day 6')
                                                  .replace(/ VII$/g, ' Day 7')
                                                  .replace(/ VIII$/g, ' Day 8');
                            label += ` (${cleanMemo})`;
                        }
                        zmanim.push({
                            label: label.toUpperCase(),
                            time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                            timestamp: d.getTime(),
                            date: d
                        });
                    }
                }
            });

            // If parashat was not in this response (e.g. during a holiday week or early in the week),
            // query Hebcal specifically for the upcoming Shabbat
            if (!fetchedParsha) {
                try {
                    const dayOfWeek = targetDate.getDay();
                    let daysUntilShabbat = (6 - dayOfWeek + 7) % 7;
                    if (dayOfWeek === 6 && fetchedSunsetDate && nowMs > fetchedSunsetDate.getTime()) {
                        daysUntilShabbat = 7;
                    }
                    const shabbatDate = new Date(targetDate.getTime() + daysUntilShabbat * 24 * 60 * 60 * 1000);
                    const shabbatUrl = `https://www.hebcal.com/shabbat/?cfg=json&latitude=${lat}&longitude=${lon}&gy=${shabbatDate.getFullYear()}&gm=${shabbatDate.getMonth() + 1}&gd=${shabbatDate.getDate()}&M=on&tzid=${effectiveTz}`;
                    const sRes = await fetch(shabbatUrl, { headers: fetchHeaders });
                    if (sRes.ok) {
                        const sJson = await sRes.json();
                        const sItems = sJson.items || [];
                        let shabbatCandle = null;
                        sItems.forEach(si => {
                            if (si.category === 'parashat') {
                                fetchedParsha = {
                                    parshaName: si.title,
                                    parshaHebrew: si.hebrew,
                                    haftarah: si.leyning?.haftarah || si.haftarah || null,
                                    date: si.date,
                                    link: si.link
                                };
                            }
                            if (si.category === 'candles') {
                                const cd = new Date(si.date);
                                shabbatCandle = cd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                            }
                        });
                        // If Shabbat coincides with a Yom Tov festival
                        if (!fetchedParsha) {
                            const yomTovItem = sItems.find(si => si.category === 'holiday' && (si.yomtov || si.subcat === 'major' || si.leyning));
                            if (yomTovItem) {
                                fetchedParsha = {
                                    parshaName: yomTovItem.title,
                                    parshaHebrew: yomTovItem.hebrew || yomTovItem.title,
                                    haftarah: yomTovItem.leyning?.haftarah || null,
                                    date: yomTovItem.date,
                                    link: yomTovItem.link
                                };
                            }
                        }
                        if (fetchedParsha && shabbatCandle) {
                            fetchedParsha.candleLighting = shabbatCandle;
                        }
                    }
                } catch (shabbatErr) {}
            }

            if (fetchedParsha && !cancelled) {
                setParshaInfo(fetchedParsha);
            }
            
            if (zmanim.length > 0) {
                zmanim.sort((a, b) => a.timestamp - b.timestamp);
                if (!cancelled) {
                    setAllZmanim(zmanim);
                    setUpcomingZmanim(zmanim.slice(0, 3)); // Show up to next 3 zmanim
                    havFetched = true;
                }
            }
          }
        } catch (e) {
        }

        // 2.5. Fetch detailed Zmanim from Hebcal zmanim API for comprehensive zmanim card
        let fullList = [];
        try {
          const zUrl = `https://www.hebcal.com/zmanim?cfg=json&latitude=${lat}&longitude=${lon}&date=${dateStr}&tzid=${effectiveTz}`;
          const zRes = await fetch(zUrl, { headers: fetchHeaders });
          if (zRes.ok) {
            const zJson = await zRes.json();
            const t = zJson.times || {};
            const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
            if (t.alotHaShachar || t.alosHaShachar || t.dawn) fullList.push({ label: 'Alos HaShachar', time: fmt(t.alotHaShachar || t.alosHaShachar || t.dawn) });
            if (t.sunrise) fullList.push({ label: 'Netz (Sunrise)', time: fmt(t.sunrise) });
            if (t.sofZmanShma || t.sofZmanShmaMGA) fullList.push({ label: 'Sof Zman Shema (Gra)', time: fmt(t.sofZmanShma || t.sofZmanShmaMGA) });
            if (t.sofZmanTfilla || t.sofZmanTfillaMGA) fullList.push({ label: 'Sof Zman Tefillah', time: fmt(t.sofZmanTfilla || t.sofZmanTfillaMGA) });
            if (t.chatzot) fullList.push({ label: 'Chatzos (Midday)', time: fmt(t.chatzot) });
            if (t.minchaGedola) fullList.push({ label: 'Mincha Gedola', time: fmt(t.minchaGedola) });
            if (t.plagHaMincha) fullList.push({ label: 'Plag HaMincha', time: fmt(t.plagHaMincha) });
            if (t.sunset) fullList.push({ label: 'Shkiah (Sunset)', time: fmt(t.sunset) });
            if (t.tzeit85deg || t.tzeit50min || t.tzeit42min || t.tzeit) fullList.push({ label: 'Tzais (Nightfall)', time: fmt(t.tzeit85deg || t.tzeit50min || t.tzeit42min || t.tzeit) });
            if (t.tzeit72min) fullList.push({ label: 'Tzais (72 Min)', time: fmt(t.tzeit72min) });
            if (!cancelled && fullList.length > 0) {
              setFullZmanimTable(fullList);
            }
          }
        } catch (zErr) {
        }

        // 3. Fallback Havdalah calculation
        if (!havFetched && !cancelled) {
          if (fetchedSunsetDate) {
            const offsetMinutes = HAVDALAH_OFFSET_MINS; // fallback community default
            const fallbackHav = new Date(fetchedSunsetDate);
            fallbackHav.setMinutes(fallbackHav.getMinutes() + offsetMinutes);
            const nowMs = new Date().getTime();
            
            if (isZmanActive(fallbackHav, nowMs, effectiveTz)) {
                const fbItem = {
                    label: 'HAVDALAH (ESTIMATED)',
                    time: fallbackHav.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                    timestamp: fallbackHav.getTime(),
                    date: fallbackHav
                };
                setAllZmanim([fbItem]);
                setUpcomingZmanim([fbItem]);
                zmanim.push(fbItem);
            } else {
                setAllZmanim([]);
                setUpcomingZmanim([]);
            }
          } else {
            setAllZmanim([]);
            setUpcomingZmanim([]);
          }
        }

        // 4. Update any existing ZMANIM / CLOCK / PARSHA cards in displayCycle so they never stay empty
        if (!cancelled) {
          setDisplayCycle(prevCycle => {
            if (!prevCycle || prevCycle.length === 0) return prevCycle;
            return prevCycle.map(item => {
              if (item.type === 'ZMANIM') {
                let candleTime = null;
                let havdalahTime = null;
                let havdallah72Time = item.data?.havdallah72;

                zmanim.forEach(z => {
                  if (!candleTime && (z.label.includes('CANDLE') || z.label.includes('LIGHTING'))) candleTime = z.time;
                  if (!havdalahTime && z.label.includes('HAVDALAH')) havdalahTime = z.time;
                });

                if (fetchedSunsetDate) {
                  const d72 = new Date(fetchedSunsetDate.getTime() + 72 * 60 * 1000);
                  havdallah72Time = d72.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                }

                return {
                  ...item,
                  data: {
                    ...item.data,
                    locationName: placeName || item.data?.locationName || 'Local',
                    candleLighting: candleTime || item.data?.candleLighting,
                    havdallah: havdalahTime || item.data?.havdallah,
                    havdallah72: havdallah72Time || item.data?.havdallah72,
                    zmanimList: fullList.length > 0 ? fullList : (zmanim.length > 0 ? zmanim : item.data?.zmanimList || []),
                  }
                };
              }
              if (item.type === 'PARSHA') {
                let candleTime = null;
                zmanim.forEach(z => {
                  if (!candleTime && (z.label.includes('CANDLE') || z.label.includes('LIGHTING'))) candleTime = z.time;
                });
                return {
                  ...item,
                  data: {
                    ...item.data,
                    parshaName: fetchedParsha?.parshaName || (item.data?.parshaName !== 'Weekly Parsha' ? item.data?.parshaName : null) || 'Weekly Parsha',
                    parshaHebrew: fetchedParsha?.parshaHebrew || (item.data?.parshaHebrew !== 'פרשת השבוע' ? item.data?.parshaHebrew : null) || 'פרשת השבוע',
                    haftarah: fetchedParsha?.haftarah || item.data?.haftarah || null,
                    candleLighting: candleTime || fetchedParsha?.candleLighting || item.data?.candleLighting,
                    date: fetchedParsha?.date ? `SHABBAT • ${new Date(fetchedParsha.date + (fetchedParsha.date.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}` : (item.data?.date || 'SHABBAT')
                  }
                };
              }
              if (item.type === 'CLOCK') {
                return {
                  ...item,
                  data: {
                    ...item.data,
                    locationName: placeName || item.data?.locationName || 'Local',
                    sunsetTime: fetchedSunsetDate || item.data?.sunsetTime
                  }
                };
              }
              return item;
            });
          });
        }
      } catch (e) {
        if (!cancelled) {
          setAllZmanim([]);
          setUpcomingZmanim([]);
        }
      }
    };

    computeHavdalah();
    const interval = setInterval(computeHavdalah, 1000 * 60 * 30);
    return () => { cancelled = true; clearInterval(interval); }; // eslint-disable-line
  }, []);

  // Live filter active zmanim as currentTime advances across midnight
  useEffect(() => {
    if (!allZmanim || allZmanim.length === 0) return;
    const nowMs = currentTime.getTime();
    const active = allZmanim.filter(z => isZmanActive(z.timestamp, nowMs, effectiveTz));
    active.sort((a, b) => a.timestamp - b.timestamp);
    const sliced = active.slice(0, 3);
    setUpcomingZmanim(prev => {
      if (prev.length === sliced.length && prev.every((p, i) => p.label === sliced[i].label && p.time === sliced[i].time)) {
        return prev;
      }
      return sliced;
    });
  }, [allZmanim, currentTime, effectiveTz]);

  // When calendar date rolls over past midnight, trigger a fresh computeHavdalah immediately
  useEffect(() => {
    const todayStr = currentTime.getFullYear() + "-" + String(currentTime.getMonth() + 1).padStart(2, '0') + "-" + String(currentTime.getDate()).padStart(2, '0');
    if (lastFetchedDateRef.current && lastFetchedDateRef.current !== todayStr) {
      lastFetchedDateRef.current = todayStr;
      if (computeHavdalahRef.current) {
        computeHavdalahRef.current();
      }
    }
  }, [currentTime]);

  const fetchData = useCallback(async () => {
      try {
        // --- 1. UNIVERSAL NEWS FETCH ENGINE ---
        const fetchRssFeed = async (url, sourceName) => {
            try {
                const separator = url.includes('?') ? '&' : '?';
                const res = await fetch(`${url}${separator}_=${Date.now()}`, { headers: fetchHeaders });
                if (!res.ok) return [];
                const text = await res.text();
                
                const items = text.split(/<item\b|<entry\b/i);
                const parsedNews = [];
                
                for (let i = 1; i < items.length; i++) {
                    const itemXml = items[i];
                    const titleMatch = itemXml.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) 
                                    || itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
                    
                    const dateMatch = itemXml.match(/<(pubDate|updated|dc:date|published)[^>]*>(.*?)<\/\1>/i);
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

                    // Extract body/content from RSS or Atom tags (priority: content:encoded > content > description > summary)
                    const contentEncodedMatch = itemXml.match(/<content:encoded[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i)
                                             || itemXml.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
                    const contentMatch = itemXml.match(/<content[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/content>/i)
                                      || itemXml.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
                    const descMatch = itemXml.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)
                                   || itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
                    const summaryMatch = itemXml.match(/<summary[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/summary>/i)
                                      || itemXml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

                    let rawBody = '';
                    if (contentEncodedMatch && contentEncodedMatch[1]?.trim()) {
                      rawBody = contentEncodedMatch[1];
                    } else if (contentMatch && contentMatch[1]?.trim()) {
                      rawBody = contentMatch[1];
                    } else if (descMatch && descMatch[1]?.trim()) {
                      rawBody = descMatch[1];
                    } else if (summaryMatch && summaryMatch[1]?.trim()) {
                      rawBody = summaryMatch[1];
                    }

                    const cleanTitle = titleMatch ? cleanHtmlAndExtractText(titleMatch[1]) : '';
                    const cleanBody = cleanHtmlAndExtractText(rawBody);

                    if (cleanTitle || cleanBody) {
                      parsedNews.push({
                        title: cleanTitle.trim() || 'Announcement',
                        body: cleanBody.trim(),
                        source: sourceName,
                        date: dateStr
                      });
                    }
                }
                return parsedNews;
            } catch (err) {
                return [];
            }
        };

        // --- 1.5. SCOREBOARD FETCH ENGINE ---
        const fetchScoreboard = async (sport, targetLeague, id) => {
            try {
                const url = targetLeague === 'college-football'
                    ? `https://site.api.espn.com/apis/site/v2/sports/${sport}/${targetLeague}/scoreboard?groups=80&limit=100&_=${Date.now()}`
                    : `https://site.api.espn.com/apis/site/v2/sports/${sport}/${targetLeague}/scoreboard?_=${Date.now()}`;
                const res = await fetch(url, { headers: fetchHeaders });
                if (!res.ok) throw new Error('Failed to fetch scoreboard');
                const json = await res.json();
                let events = json.events || [];

                if (targetLeague === 'college-football') {
                    events = events.filter(ev => {
                        const comp = ev.competitions?.[0];
                        if (!comp) return false;
                        const groupName = (comp.groups?.name || comp.groups?.shortName || '').toUpperCase();
                        const groupId = String(comp.groups?.id || '');
                        if (groupId === '81' || groupName.includes('FCS') || groupName.includes('I-AA')) {
                            return false;
                        }
                        const fcsConferences = ['BIG SKY', 'IVY LEAGUE', 'MEAC', 'MVFC', 'MISSOURI VALLEY FOOTBALL', 'NORTHEAST', 'OHIO VALLEY', 'OVC', 'PATRIOT LEAGUE', 'PIONEER', 'SOCON', 'SOUTHERN CONFERENCE', 'SOUTHLAND', 'SWAC', 'SOUTHWESTERN ATHLETIC', 'UNITED ATHLETIC', 'UAC', 'COLONIAL ATHLETIC', 'CAA FOOTBALL'];
                        const homeConf = (comp.competitors?.find(c => c.homeAway === 'home')?.team?.conference?.name || '').toUpperCase();
                        const awayConf = (comp.competitors?.find(c => c.homeAway === 'away')?.team?.conference?.name || '').toUpperCase();
                        if (homeConf && awayConf && fcsConferences.some(f => homeConf.includes(f)) && fcsConferences.some(f => awayConf.includes(f))) {
                            return false;
                        }
                        return true;
                    });
                }
                
                let headerPrefix = "TODAY'S";
                const hasStarted = events.some(e => e.status?.type?.state === 'in' || e.status?.type?.state === 'post');
                const hasLive = events.some(e => e.status?.type?.state === 'in' || e.competitions?.[0]?.status?.type?.state === 'in');

                if (!hasStarted && targetLeague !== 'nfl' && targetLeague !== 'college-football') {
                    const now = new Date();
                    const yDate = new Date(now);
                    yDate.setDate(yDate.getDate() - 1);
                    const yestStr = yDate.getFullYear() + String(yDate.getMonth() + 1).padStart(2, '0') + String(yDate.getDate()).padStart(2, '0');
                    
                    const urlYest = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${targetLeague}/scoreboard?dates=${yestStr}`;
                    const resYest = await fetch(urlYest, { headers: fetchHeaders });
                    if (resYest.ok) {
                        const jsonYest = await resYest.json();
                        const yesterdayEvents = jsonYest.events || [];
                        
                        if (yesterdayEvents.length > 0) {
                            if (events.length > 0 && events.length < 4) {
                                events = [...yesterdayEvents, ...events];
                            } else {
                                events = yesterdayEvents;
                            }
                        }
                    }
                }

                // Calculate accurate header prefix based on event dates
                if (events.length > 0) {
                    const now = new Date();
                    const todayStr = now.toDateString();
                    const yDate = new Date(now); yDate.setDate(yDate.getDate() - 1);
                    const yestStr = yDate.toDateString();
                    
                    let hasToday = false;
                    let hasYesterday = false;
                    let minDate = null;
                    let maxDate = null;

                    events.forEach(e => {
                        if (!e.date) return;
                        const d = new Date(e.date);
                        const dStr = d.toDateString();
                        if (dStr === todayStr) hasToday = true;
                        else if (dStr === yestStr) hasYesterday = true;
                        
                        if (!minDate || d < minDate) minDate = d;
                        if (!maxDate || d > maxDate) maxDate = d;
                    });

                    const formatHeaderDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();

                    let footballPlayoffText = null;
                    if ((targetLeague === 'nfl' || targetLeague === 'college-football') && events[0]?.season?.type === 3) {
                        footballPlayoffText = (events[0]?.week?.text || json.week?.text || (targetLeague === 'college-football' ? "BOWLS / PLAYOFF" : "PLAYOFF")).toUpperCase();
                    }

                    if (footballPlayoffText) {
                        headerPrefix = footballPlayoffText;
                    } else if (targetLeague === 'nfl' || targetLeague === 'college-football' || (!hasToday && !hasYesterday)) {
                        if (minDate && maxDate && minDate.toDateString() !== maxDate.toDateString()) {
                            headerPrefix = `${formatHeaderDate(minDate)} - ${formatHeaderDate(maxDate)}`;
                        } else if (minDate) {
                            headerPrefix = formatHeaderDate(minDate);
                        } else {
                            headerPrefix = "LATEST";
                        }
                    } else if (hasYesterday && hasToday) {
                        headerPrefix = "YESTERDAY & TODAY'S";
                    } else if (hasYesterday) {
                        headerPrefix = "YESTERDAY'S";
                    } else {
                        headerPrefix = "TODAY'S";
                    }
                } else {
                    if (targetLeague === 'nfl' || targetLeague === 'college-football') headerPrefix = "LATEST";
                    else headerPrefix = "TODAY'S";
                }

                const parseScoreText = (c) => {
                    if (c?.score == null) return "-";
                    if (typeof c.score === 'object') return String(c.score.displayValue ?? c.score.value ?? "-");
                    return String(c.score);
                };

                // Fetch standings for division leaders
                let divisionLeaders = [];
                try {
                    const stUrl = `https://site.api.espn.com/apis/v2/sports/${sport}/${targetLeague}/standings?level=3`;
                    const stRes = await fetch(stUrl, { headers: fetchHeaders });
                    if (stRes.ok) {
                        const stJson = await stRes.json();
                        
                        const extractLeaders = (node, parentAbbr = '') => {
                            let currentAbbr = parentAbbr;
                            const nodeName = (node.name || '').toUpperCase();
                            const nodeAbbrev = (node.abbreviation || '').toUpperCase();
                            
                            if (nodeAbbrev === 'AFC' || nodeName.includes('AMERICAN FOOTBALL')) currentAbbr = 'AFC';
                            else if (nodeAbbrev === 'NFC' || nodeName.includes('NATIONAL FOOTBALL')) currentAbbr = 'NFC';
                            else if (nodeAbbrev === 'AL' || nodeName.includes('AMERICAN LEAGUE')) currentAbbr = 'AL';
                            else if (nodeAbbrev === 'NL' || nodeName.includes('NATIONAL LEAGUE')) currentAbbr = 'NL';

                            // If a node has children, it's a grouping like a conference. Recurse into them.
                            if (node.children && Array.isArray(node.children) && node.children.length > 0) {
                                node.children.forEach(child => extractLeaders(child, currentAbbr));
                            }
                            // If a node has no children but has standings, it's a division or a flat list.
                            else if (node.standings && node.standings.entries && node.standings.entries.length > 0) {
                                const sortedEntries = [...node.standings.entries].sort((a, b) => {
                                    let aSort = 0, bSort = 0;
                                    if (sport === 'hockey') {
                                        const aPts = a.stats?.find(s => s.name === 'points' || s.abbreviation === 'PTS');
                                        const bPts = b.stats?.find(s => s.name === 'points' || s.abbreviation === 'PTS');
                                        aSort = parseFloat(aPts?.value ?? aPts?.displayValue ?? 0);
                                        bSort = parseFloat(bPts?.value ?? bPts?.displayValue ?? 0);
                                    } else {
                                        const aPct = a.stats?.find(s => s.name === 'winPercent' || s.name === 'winPercentage');
                                        const bPct = b.stats?.find(s => s.name === 'winPercent' || s.name === 'winPercentage');
                                        if (aPct) aSort = parseFloat(aPct.value ?? aPct.displayValue ?? 0);
                                        else {
                                            const aW = parseFloat(a.stats?.find(s => s.name === 'wins')?.value ?? 0);
                                            const aL = parseFloat(a.stats?.find(s => s.name === 'losses')?.value ?? 0);
                                            if (aW + aL > 0) aSort = aW / (aW + aL);
                                        }
                                        if (bPct) bSort = parseFloat(bPct.value ?? bPct.displayValue ?? 0);
                                        else {
                                            const bW = parseFloat(b.stats?.find(s => s.name === 'wins')?.value ?? 0);
                                            const bL = parseFloat(b.stats?.find(s => s.name === 'losses')?.value ?? 0);
                                            if (bW + bL > 0) bSort = bW / (bW + bL);
                                        }
                                    }
                                    return bSort - aSort;
                                });

                                const leader = sortedEntries[0];
                                const teamObj = leader.team || {};
                                const stats = leader.stats || [];
                                let recordStr = '';
                                let sortValue = 0;

                                if (sport === 'hockey') {
                                    const pointsStat = stats.find(s => s.name === 'points' || s.abbreviation === 'PTS');
                                    if (pointsStat) {
                                        recordStr = `${pointsStat.displayValue || pointsStat.value} PTS`;
                                        sortValue = parseFloat(pointsStat.value ?? pointsStat.displayValue ?? 0);
                                    }
                                }

                                if (!recordStr) {
                                    const summaryStat = stats.find(s => s.name === 'overall' || s.name === 'summary' || s.type === 'total');
                                    if (summaryStat) {
                                        recordStr = summaryStat.displayValue || summaryStat.summary || summaryStat.value;
                                    } else {
                                        const wins = stats.find(s => s.name === 'wins')?.displayValue || '0';
                                        const losses = stats.find(s => s.name === 'losses')?.displayValue || '0';
                                        recordStr = `${wins}-${losses}`;
                                    }
                                }
                                
                                if (sport !== 'hockey') {
                                    const winPctStat = stats.find(s => s.name === 'winPercent' || s.name === 'winPercentage');
                                    if (winPctStat) {
                                        sortValue = parseFloat(winPctStat.value ?? winPctStat.displayValue ?? 0);
                                    } else {
                                        const wins = parseFloat(stats.find(s => s.name === 'wins')?.value ?? 0);
                                        const losses = parseFloat(stats.find(s => s.name === 'losses')?.value ?? 0);
                                        if (wins + losses > 0) sortValue = wins / (wins + losses);
                                    }
                                }
                                
                                let divName = node.name || node.abbreviation || 'Div';
                                if (currentAbbr && !divName.toUpperCase().includes(currentAbbr) && !divName.includes('League') && !divName.includes('Conference')) {
                                    divName = `${currentAbbr} ${divName}`;
                                }
                                
                                divName = divName.replace(/American Football Conference/i, 'AFC')
                                                 .replace(/National Football Conference/i, 'NFC')
                                                 .replace(/American League/i, 'AL')
                                                 .replace(/National League/i, 'NL')
                                                 .replace(/Conference/i, '')
                                                 .replace(/Division/i, '')
                                                 .replace(/Eastern/i, 'East')
                                                 .replace(/Western/i, 'West')
                                                 .replace(/Northern/i, 'North')
                                                 .replace(/Southern/i, 'South')
                                                 .replace(/Metropolitan/i, 'Metro')
                                                 .trim();
                                
                                divisionLeaders.push({
                                    divName: divName,
                                    team: teamObj.abbreviation || teamObj.name || 'TBA',
                                    record: recordStr,
                                    sortValue
                                });
                            }
                        };
                        
                        if (stJson.children) {
                            stJson.children.forEach(child => extractLeaders(child));
                        }
                        
                        if (divisionLeaders.length === 0 && stJson.standings && stJson.standings.entries) {
                            const sortedFallback = [...stJson.standings.entries].sort((a, b) => {
                                let aSort = 0, bSort = 0;
                                if (sport === 'hockey') {
                                    const aPts = a.stats?.find(s => s.name === 'points' || s.abbreviation === 'PTS');
                                    const bPts = b.stats?.find(s => s.name === 'points' || s.abbreviation === 'PTS');
                                    aSort = parseFloat(aPts?.value ?? aPts?.displayValue ?? 0);
                                    bSort = parseFloat(bPts?.value ?? bPts?.displayValue ?? 0);
                                } else {
                                    const aPct = a.stats?.find(s => s.name === 'winPercent' || s.name === 'winPercentage');
                                    const bPct = b.stats?.find(s => s.name === 'winPercent' || s.name === 'winPercentage');
                                    if (aPct) aSort = parseFloat(aPct.value ?? aPct.displayValue ?? 0);
                                    else {
                                        const aW = parseFloat(a.stats?.find(s => s.name === 'wins')?.value ?? 0);
                                        const aL = parseFloat(a.stats?.find(s => s.name === 'losses')?.value ?? 0);
                                        if (aW + aL > 0) aSort = aW / (aW + aL);
                                    }
                                    if (bPct) bSort = parseFloat(bPct.value ?? bPct.displayValue ?? 0);
                                    else {
                                        const bW = parseFloat(b.stats?.find(s => s.name === 'wins')?.value ?? 0);
                                        const bL = parseFloat(b.stats?.find(s => s.name === 'losses')?.value ?? 0);
                                        if (bW + bL > 0) bSort = bW / (bW + bL);
                                    }
                                }
                                return bSort - aSort;
                            });
                            
                            const top = sortedFallback.slice(0, 4);
                            top.forEach((leader, idx) => {
                                const teamObj = leader.team || {};
                                const stats = leader.stats || [];
                                let recordStr = '';
                                let sortValue = 0;
                                
                                if (sport === 'hockey') {
                                    const pointsStat = stats.find(s => s.name === 'points' || s.abbreviation === 'PTS');
                                    if (pointsStat) {
                                        recordStr = `${pointsStat.displayValue || pointsStat.value} PTS`;
                                        sortValue = parseFloat(pointsStat.value ?? pointsStat.displayValue ?? 0);
                                    }
                                } else {
                                    const winPctStat = stats.find(s => s.name === 'winPercent' || s.name === 'winPercentage');
                                    if (winPctStat) sortValue = parseFloat(winPctStat.value ?? winPctStat.displayValue ?? 0);
                                }
                                
                                if (!recordStr) {
                                    const summaryStat = stats.find(s => s.name === 'overall' || s.name === 'summary' || s.type === 'total');
                                    if (summaryStat) {
                                        recordStr = summaryStat.displayValue || summaryStat.summary || summaryStat.value;
                                    } else {
                                        const wins = stats.find(s => s.name === 'wins')?.displayValue || '0';
                                        const losses = stats.find(s => s.name === 'losses')?.displayValue || '0';
                                        recordStr = `${wins}-${losses}`;
                                    }
                                }
                                divisionLeaders.push({
                                    divName: `#${idx+1}`,
                                    team: teamObj.abbreviation || teamObj.name || 'TBA',
                                    record: recordStr,
                                    sortValue
                                });
                            });
                        }
                        
                        divisionLeaders.sort((a, b) => b.sortValue - a.sortValue);
                    }
                } catch (e) {
                }

                const logoLeague = (targetLeague === 'college-football' || targetLeague === 'ncaaf') ? 'ncaa' : targetLeague;
                const isNcaa = targetLeague === 'college-football' || targetLeague === 'ncaaf';
                const formattedEvents = events.map(ev => {
                    const comp = ev.competitions?.[0];
                    const home = comp?.competitors?.find(c => c.homeAway === 'home');
                    const away = comp?.competitors?.find(c => c.homeAway === 'away');
                    let statusStr = ev.status?.type?.shortDetail || 'TBD';
                    
                    statusStr = statusStr.replace(/\s+(EST|EDT|CST|CDT|MST|MDT|PST|PDT)/gi, '');
                    
                    if (targetLeague === 'mlb' && (statusStr.includes('Bot') || statusStr.includes('Top'))) {
                        statusStr = statusStr.replace(/Bot(tom)?\s+/i, '▼ ').replace(/Top\s+/i, '▲ ');
                    }

                    const awayRank = isNcaa ? parseRank(away) : null;
                    const homeRank = isNcaa ? parseRank(home) : null;
                    
                    return {
                        id: ev.id,
                        name: ev.name,
                        status: statusStr,
                        away: {
                            abbr: away?.team?.abbreviation || 'TBA',
                            rank: awayRank,
                            logo: away?.team?.logo || `https://a.espncdn.com/i/teamlogos/${logoLeague}/500/${away?.team?.abbreviation?.toLowerCase() || 'tba'}.png`,
                            score: parseScoreText(away),
                            winner: away?.winner
                        },
                        home: {
                            abbr: home?.team?.abbreviation || 'TBA',
                            rank: homeRank,
                            logo: home?.team?.logo || `https://a.espncdn.com/i/teamlogos/${logoLeague}/500/${home?.team?.abbreviation?.toLowerCase() || 'tba'}.png`,
                            score: parseScoreText(home),
                            winner: home?.winner
                        }
                    };
                });

                const chunks = [];
                const isCardsMode = (preferences?.format || 'classic') === 'cards';
                const chunkSize = isTablet ? (isCardsMode ? 12 : 6) : 6; // 12 on tablet Cards (up to 3 rows of 4), 6 on classic tablet and phone
                for (let i = 0; i < formattedEvents.length; i += chunkSize) {
                    chunks.push({
                        type: 'SCOREBOARD',
                        data: {
                            id: `${id}-chunk-${i/chunkSize}`,
                            prefId: id,
                            targetLeague: targetLeague.toUpperCase(),
                            sport,
                            chunkIndex: i / chunkSize,
                            totalPages: Math.ceil(formattedEvents.length / chunkSize),
                            events: formattedEvents.slice(i, i + chunkSize),
                            headerText: `${headerPrefix} ${formatLeagueName(targetLeague)} SCORES`,
                            divisionLeaders,
                            isLive: hasLive
                        }
                    });
                }
                
                if (chunks.length === 0) {
                    chunks.push({ type: 'SCOREBOARD', data: { id: `${id}-empty`, prefId: id, targetLeague: targetLeague.toUpperCase(), sport, chunkIndex: 0, totalPages: 1, events: [], headerText: `${headerPrefix} ${formatLeagueName(targetLeague)} SCORES`, divisionLeaders, isLive: false } });
                }
                
                return chunks;
            } catch (e) {
                return [];
            }
        };

        const buildWeatherCard = async () => {
            let coords = locationCoords;
            let placeName = locationName || 'Local';
            try {
                if (!coords) {
                    const { status } = await Location.requestForegroundPermissionsAsync();
                    if (status !== 'granted') return null;
                    const loc = await Location.getCurrentPositionAsync({});
                    coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
                    setLocationCoords(coords);
                    try {
                        const reverse = await Location.reverseGeocodeAsync(coords);
                        if (reverse?.length) {
                            const place = reverse[0];
                            placeName = place.city || place.region || place.subregion || place.country || 'Local';
                            setLocationName(placeName);
                        }
                    } catch (geocodeErr) {
                        // ignore reverse geocode failures
                    }
                }

                if (!coords) return null;

                const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&hourly=temperature_2m,precipitation_probability,weathercode,is_day&daily=temperature_2m_max,temperature_2m_min,weathercode&current=temperature_2m,apparent_temperature,weather_code,is_day&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&_=${Date.now()}`;
                const weatherRes = await fetch(weatherUrl, { headers: fetchHeaders });
                if (!weatherRes.ok) throw new Error('Weather service error');
                const weatherJson = await weatherRes.json();
                if (weatherJson.timezone) setTimeZone(weatherJson.timezone);

                const current = weatherJson.current || weatherJson.current_weather || {};
                const daily = weatherJson.daily || {};
                const hourly = weatherJson.hourly || {};
                const currentTemp = current.temperature_2m ?? current.temperature ?? 0;
                const isDay = current.is_day ?? 1;
                const formatHourLabel = (time) => {
                    if (!time) return '';
                    return new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }).replace(':00', '');
                };
                const currentMs = Date.now();
                let timeIndex = (hourly.time || []).findIndex(t => new Date(t).getTime() >= currentMs - WEATHER_STALE_MS); // >= 30 mins ago
                if (timeIndex === -1) timeIndex = 0;
                const forecast = [];
                for (let i = timeIndex; i < Math.min(timeIndex + 5, (hourly.time || []).length); i++) {
                    const time = hourly.time[i];
                    const isDayHourly = hourly.is_day?.[i] ?? 1;
                    forecast.push({
                        label: formatHourLabel(time),
                        icon: getWeatherEmoji(Number(hourly.weathercode?.[i] ?? 0), isDayHourly),
                        temp: Math.round(hourly.temperature_2m?.[i] ?? currentTemp),
                        pop: Math.round(hourly.precipitation_probability?.[i] ?? 0)
                    });
                }

                const code = Number(current.weather_code ?? current.weathercode ?? daily.weathercode?.[0] ?? 0);
                const condition = getWeatherDescription(code);
                const icon = getWeatherEmoji(code, isDay);
                const backgroundColor = getWeatherBackground(code, isDay);
                const high = Math.round(daily.temperature_2m_max?.[0] ?? currentTemp);
                const low = Math.round(daily.temperature_2m_min?.[0] ?? currentTemp);
                const feelsLike = Math.round(current.apparent_temperature ?? currentTemp);
                const precip = forecast[0]?.pop != null ? `${forecast[0].pop}%` : '0%';

                return {
                    city: placeName,
                    temperature: `${Math.round(currentTemp)}°`,
                    feelsLike: `${feelsLike}°`,
                    condition,
                    icon,
                    backgroundColor,
                    high: `${high}°`,
                    low: `${low}°`,
                    precip,
                    forecast,
                    code,
                    isDay
                };
            } catch (error) {
                return {
                    city: 'Local Weather',
                    temperature: '--',
                    feelsLike: '--',
                    condition: 'Unavailable',
                    icon: '❓',
                backgroundColor: ['#4A76E1', '#4A76E1'],
                    high: '--',
                    low: '--',
                    precip: '--',
                    forecast: []
                };
            }
        };

        // --- NFL DRAFT FETCH ENGINE ---
        const fetchNflDraft = async () => {
            try {
                let currentYear = new Date().getFullYear();
                let rawPicks = [];
                let rawPositions = [];
                let nextPick = null;

                // Fetch official NFL teams list to accurately map team IDs
                let nflTeams = [];
                try {
                    const tRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams?limit=32', { headers: fetchHeaders });
                    if (tRes.ok) {
                        const tJson = await tRes.json();
                        nflTeams = tJson.sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team) || [];
                    }
                } catch (e) {}

                const getDraftData = async (year) => {
                    try {
                        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/draft?season=${year}&_=${Date.now()}`, { headers: fetchHeaders });
                        if (!res.ok) return { picks: [], positions: [] };
                        const json = await res.json();
                        
                        let picks = [];
                        if (json.draft && json.draft.picks) picks = json.draft.picks;
                        else if (json.drafts && json.drafts.length > 0 && json.drafts[0].picks) picks = json.drafts[0].picks;
                        else if (json.picks && json.picks.length > 0) picks = json.picks;
                        
                        let positions = [];
                        if (json.positions) positions = json.positions;
                        else if (json.draft && json.draft.positions) positions = json.draft.positions;

                        return { picks, positions };
                    } catch (err) {}
                    return { picks: [], positions: [] };
                };

                let draftData = await getDraftData(currentYear);
                rawPicks = draftData.picks;
                rawPositions = draftData.positions;
                
                // If current year's draft hasn't started/populated, fallback to previous year
                if (!rawPicks || rawPicks.length === 0) {
                    currentYear -= 1;
                    draftData = await getDraftData(currentYear);
                    rawPicks = draftData.picks;
                    rawPositions = draftData.positions;
                }

                if (!rawPicks || !Array.isArray(rawPicks)) {
                    rawPicks = [];
                }

                const formattedPicks = rawPicks.map(p => {
                    try {
                    const athlete = p.athlete || p.player || {};
                    const pickTeamId = String(p.team?.id || p.teamId || '');
                    const team = nflTeams.find(t => String(t.id) === pickTeamId) || p.team || {};
                    
                    let logoUrl = 'https://a.espncdn.com/i/teamlogos/nfl/500/nfl.png';
                    if (team.logos && team.logos.length > 0) logoUrl = team.logos[0].href;
                    else if (team.logo) logoUrl = team.logo;
                    else if (team.abbreviation) logoUrl = `https://a.espncdn.com/i/teamlogos/nfl/500/${String(team.abbreviation).toLowerCase()}.png`;

                        const prospect = p.prospect || athlete.prospect || {};
                        
                        // Robust recursive extractor for deeply buried API properties
                        const extractName = (source, preferAbbr = false) => {
                            if (!source) return null;
                            if (typeof source === 'string') return source;
                            if (Array.isArray(source)) return extractName(source[0], preferAbbr);
                            if (preferAbbr && source.abbreviation) return source.abbreviation;
                            if (preferAbbr && source.shortName) return source.shortName;
                            if (source.shortDisplayName) return source.shortDisplayName;
                            if (source.location) return source.location;
                            if (source.name) return source.name;
                            if (source.displayName) return source.displayName;
                            if (source.shortName) return source.shortName;
                            if (source.abbreviation) return source.abbreviation;
                            return null;
                        };

                        // Absolute last resort finder if ESPN completely restructures the JSON
                        const findDeep = (obj, keyName) => {
                            if (!obj || typeof obj !== 'object') return null;
                            if (obj[keyName]) return obj[keyName];
                            for (const k in obj) {
                                const res = findDeep(obj[k], keyName);
                                if (res) return res;
                            }
                            return null;
                        };

                        let pos = 'UNK';
                        let posId = String(prospect.position?.id || athlete.position?.id || p.position?.id || p.positionId || athlete.positionId || '');
                        if (posId && posId !== 'undefined' && rawPositions?.length > 0) {
                            const matchedPos = rawPositions.find(rp => String(rp.id) === posId);
                            if (matchedPos && matchedPos.abbreviation) pos = matchedPos.abbreviation;
                        }
                        if (pos === 'UNK') {
                            pos = extractName(prospect.position, true)
                               || extractName(athlete.position, true)
                               || extractName(athlete.positions, true)
                               || extractName(p.position, true)
                               || extractName(p.positions, true)
                               || prospect.positionAbbreviation
                               || athlete.positionAbbreviation
                               || 'UNK';
                        }
                        if (pos === 'UNK') pos = extractName(findDeep(p, 'position'), true) || 'UNK';

                        let col = 'UNK';
                        let colId = String(prospect.college?.id || athlete.college?.id || p.college?.id || p.collegeId || athlete.collegeId || prospect.collegeId || '');
                        if (colId && colId !== 'undefined' && rawColleges?.length > 0) {
                            const matchedCol = rawColleges.find(rc => String(rc.id) === colId);
                            if (matchedCol) col = extractName(matchedCol) || 'UNK';
                        }
                        if (col === 'UNK') {
                            col = extractName(prospect.college)
                               || extractName(athlete.college)
                               || extractName(p.college)
                               || extractName(athlete.school)
                               || extractName(p.school)
                               || extractName(athlete.collegeTeam)
                               || extractName(p.collegeTeam)
                               || extractName(athlete.team)
                               || prospect.collegeName
                               || athlete.collegeName
                               || p.collegeName
                               || 'UNK';
                        }
                        if (col === 'UNK') col = extractName(findDeep(p, 'college')) || extractName(findDeep(p, 'school')) || 'UNK';
                        
                        // Deep search for player profile arrays
                        if (col === 'UNK') {
                            const profileArr = athlete.playerProfile || p.playerProfile || prospect.playerProfile || athlete.profile || p.profile;
                            if (Array.isArray(profileArr)) {
                                const collegeStat = profileArr.find(prof => String(prof.name).toLowerCase() === 'college' || String(prof.name).toLowerCase() === 'school');
                                if (collegeStat && (collegeStat.value || collegeStat.displayValue)) col = collegeStat.value || collegeStat.displayValue;
                            } else if (profileArr && typeof profileArr === 'object') {
                                col = profileArr.college || profileArr.school || profileArr.collegeName || 'UNK';
                            }
                        }

                        // Safely extract Trade details or flags
                        let tradeText = null;
                        if (typeof p.trade === 'string') {
                            tradeText = p.trade;
                        } else if (p.trade && typeof p.trade === 'object') {
                            tradeText = p.trade.shortDescription || p.trade.description || 'Traded Pick';
                        } else if (p.tradeDescription) {
                            tradeText = p.tradeDescription;
                        } else if (p.trade === true || p.isTrade === true || p.traded === true) {
                            tradeText = 'Traded Pick';
                        }

                    return {
                        round: p.round || 1,
                        pick: p.overall || p.pick || 0,
                        team: {
                            abbreviation: team.abbreviation || 'TBA',
                            name: team.displayName || team.name || team.abbreviation || 'TBA',
                            logo: logoUrl
                        },
                        player: (athlete.displayName || athlete.fullName || athlete.name) ? {
                            name: athlete.displayName || athlete.fullName || athlete.name,
                            position: pos,
                            college: col
                        } : null,
                        trade: tradeText
                    };
                    } catch (e) {
                        return { round: 1, pick: 0, team: { abbreviation: 'TBA', name: 'TBA', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nfl.png' }, player: null, trade: null };
                    }
                });

                const completedPicks = formattedPicks.filter(p => p.player).slice(-5).reverse();
                nextPick = formattedPicks.find(p => !p.player) || null;

                return {
                    type: 'NFL_DRAFT',
                    data: { recentPicks: completedPicks, nextPick: nextPick, year: currentYear }
                };
            } catch (e) {
                return {
                    type: 'NFL_DRAFT',
                    data: { recentPicks: [], nextPick: null, year: new Date().getFullYear() }
                };
            }
        };

        // --- 2. ESPN API FETCH ---
        const fetchEspnTeam = async (sport, league, abbr, teamName) => {
          const getLuminance = (hex) => {
            const color = hex.substring(1); // remove #
            const rgb = parseInt(color, 16);
            const r = (rgb >> 16) & 0xff;
            const g = (rgb >> 8) & 0xff;
            const b = (rgb >> 0) & 0xff;
            const a = [r, g, b].map(v => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            });
            return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
          };

          const getContrast = (hex1, hex2) => {
            const lum1 = getLuminance(hex1);
            const lum2 = getLuminance(hex2);
            const brightest = Math.max(lum1, lum2);
            const darkest = Math.min(lum1, lum2);
            return (brightest + 0.05) / (darkest + 0.05);
          };

          const darkenColor = (hex, percent) => {
            let r = parseInt(hex.substring(1, 3), 16);
            let g = parseInt(hex.substring(3, 5), 16);
            let b = parseInt(hex.substring(5, 7), 16);
            r = parseInt(r * (1 - percent));
            g = parseInt(g * (1 - percent));
            b = parseInt(b * (1 - percent));
            return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
          };

          const getReadableColor = (primary, alternate) => {
            const MIN_CONTRAST = 4.5;
            const textColor = '#FFFFFF';
            
            if (primary && getContrast(primary, textColor) >= MIN_CONTRAST) {
              return { backgroundColor: primary, borderColor: null };
            }
            if (alternate && getContrast(alternate, textColor) >= MIN_CONTRAST) {
              return { backgroundColor: alternate, borderColor: primary };
            }
            if (primary) {
              let darkened = primary;
              while (getContrast(darkened, textColor) < MIN_CONTRAST) {
                darkened = darkenColor(darkened, 0.1);
              }
              return { backgroundColor: darkened, borderColor: primary };
            }
            return { backgroundColor: '#15234b', borderColor: null }; // Fallback
          };

          let record = "0-0";
          let teamJson = {};
          
          try {
            let teamRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${abbr}`, { headers: fetchHeaders });
            if (!teamRes.ok) {
                const allTeamsRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams?limit=200`, { headers: fetchHeaders });
                if (allTeamsRes.ok) {
                    const allTeamsJson = await allTeamsRes.json();
                    const teamsList = allTeamsJson.sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team) || [];
                    const matchedTeam = teamsList.find(t => 
                        String(t.abbreviation).toLowerCase() === abbr.toLowerCase() || 
                        String(t.name).toLowerCase() === teamName.toLowerCase() ||
                        String(t.displayName).toLowerCase() === teamName.toLowerCase()
                    );
                    if (matchedTeam) {
                        teamRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${matchedTeam.id}`, { headers: fetchHeaders });
                    }
                }
            }

            if (teamRes.ok) {
                teamJson = await teamRes.json();
                record = teamJson.team?.record?.items?.[0]?.summary || "0-0";
            }

            const colorInfo = getReadableColor(`#${teamJson.team?.color || '15234b'}`, teamJson.team?.alternateColor ? `#${teamJson.team.alternateColor}` : null);
            const myTeamColor = colorInfo.backgroundColor;
            const myTeamBorderColor = colorInfo.borderColor;
            const espnTeamId = teamJson.team?.id || abbr;

            const teamLogoLeague = (league === 'college-football' || league === 'ncaaf') ? 'ncaa' : league;
            const isCollegeFootball = league === 'college-football' || league === 'ncaaf';
            const fallbackCard = {
                type: 'SPORTS',
                data: {
                  trackedAbbr: abbr,
                  trackedId: String(espnTeamId),
                  league: league.toUpperCase(), date: 'OFFSEASON',
                  awayAbbr: 'TBA', awayScore: '-', awayName: 'Away',
                  awayId: 'TBA',
                  awayRank: null,
                  awayLogo: `https://a.espncdn.com/i/teamlogos/${teamLogoLeague}/500/${abbr.toLowerCase()}.png`,
                  awayRecord: '',
                  homeAbbr: abbr, homeScore: '-', homeName: teamName,
                  homeId: abbr,
                  homeRank: isCollegeFootball ? parseRank(null, teamJson?.team) : null,
                  homeLogo: `https://a.espncdn.com/i/teamlogos/${teamLogoLeague}/500/${abbr.toLowerCase()}.png`,
                  homeRecord: record,
                  status: 'No Active Games', situation: null,
                  topPlay: 'Awaiting schedule release...',
                  playerGlance: { name: teamName.toUpperCase(), subtext: '', stats: 'Offseason or Schedule Unavailable' },
                  teamColor: myTeamColor,
                  teamBorderColor: myTeamBorderColor,
                  nextGameAway: 'Schedule TBA',
                  nextGameHome: 'Schedule TBA',
                  nextGame: { date: 'Schedule TBA', opponent: 'Opponent TBA' },
                  isLive: false
                }
            };

            const fetchSchedule = async (type, year) => {
            let url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${espnTeamId}/schedule`;
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

            // Explicitly fetch playoff games (season type 3) to ensure we don't miss them
            const playoffEvents = await fetchSchedule(3);
            const existingIds = new Set(events.map(e => String(e.id)));
            for (const pe of playoffEvents) {
                if (!existingIds.has(String(pe.id))) {
                    events.push(pe);
                    existingIds.add(String(pe.id));
                }
            }
            
            const teamNextEvent = teamJson.team?.nextEvent?.[0];
            if (teamNextEvent && !existingIds.has(String(teamNextEvent.id))) {
                events.push(teamNextEvent);
            }

            if (events.length === 0) return fallbackCard;
            
            const liveEvent = events.find(e => e?.competitions?.[0]?.status?.type?.state === 'in');
            let pastGames = events.filter(e => e?.competitions?.[0]?.status?.type?.state === 'post');
            pastGames.sort((a, b) => new Date(b.date) - new Date(a.date));
            const now = new Date();
            let upcomingGames = events.filter(e => {
                const state = e?.competitions?.[0]?.status?.type?.state;
                return state === 'pre' && new Date(e.date) > now;
            });
            upcomingGames.sort((a, b) => new Date(a.date) - new Date(b.date));
            let nextUpcoming = upcomingGames[0];
            let mostRecentPast = pastGames[0];
            
            const nextEventIsLive = teamNextEvent && teamNextEvent.competitions?.[0]?.status?.type?.state === 'in';
            
            let targetEvent;
            if (liveEvent) {
              targetEvent = liveEvent;
            } else if (nextEventIsLive) {
              targetEvent = teamNextEvent;
            } else {
              targetEvent = mostRecentPast || nextUpcoming || teamNextEvent || events[0];
            }

            if (!targetEvent) return fallbackCard;

            // --- SCOREBOARD JIT FETCH ---
            // ESPN's schedule endpoint often omits scores and 'homeAway' flags for soccer. 
            // By pinging the scoreboard endpoint for this specific event, we guarantee we have the scores.
            if (targetEvent.id) {
                try {
                    const sbRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard?_=${Date.now()}`, { headers: fetchHeaders });
                    if (sbRes.ok) {
                        const sbJson = await sbRes.json();
                        if (sbJson.events && sbJson.events.length > 0) {
                            const matchedEvent = sbJson.events.find(e => String(e.id) === String(targetEvent.id));
                            if (matchedEvent) {
                                targetEvent = matchedEvent;
                            }
                        }
                    }
                } catch (e) {}
            }

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
              if (c?.score == null) return "-";
              if (typeof c.score === 'object') return String(c.score.displayValue ?? c.score.value ?? "-");
              return String(c.score);
            };

            const getLogoUrl = (team) => {
              if (!team) return null;
              if (team.logo) return team.logo;
              const logos = team.logos || [];
              const scoreboard = logos.find(l => l.rel?.includes('scoreboard'));
              const logoLeague = (league === 'college-football' || league === 'ncaaf') ? 'ncaa' : league;
              return scoreboard?.href || logos[0]?.href || `https://a.espncdn.com/i/teamlogos/${logoLeague}/500/${team.abbreviation?.toLowerCase()}.png`;
            };

            const state = comp.status?.type?.state || targetEvent.status?.type?.state || 'pre';
            const gameDate = new Date(targetEvent.date);
            const timeDiff = gameDate - now;
            
            let summaryJson = null;
            try {
              const summaryRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/summary?event=${targetEvent.id}&_=${Date.now()}`, { headers: fetchHeaders });
              if (summaryRes.ok) {
                summaryJson = await summaryRes.json();
              }
            } catch (e) {}

            const summaryComp = summaryJson?.header?.competitions?.[0];
            const sourceComp = summaryComp || comp;
            const sourceStatus = sourceComp?.status || comp?.status;
            const sourceState = sourceStatus?.type?.state || state;
            const sourceStateKey = String(sourceState || '').toLowerCase();
            const isLiveState = sourceStateKey === 'in' || sourceStateKey === 'live' || sourceStateKey === 'active';
            
            const hId = String(home.team?.id || home.id || '');
            const aId = String(away.team?.id || away.id || '');
            const sourceHome = sourceComp?.competitors?.find(c => c.homeAway === 'home' || String(c.team?.id || c.id) === hId) || home;
            const sourceAway = sourceComp?.competitors?.find(c => c.homeAway === 'away' || String(c.team?.id || c.id) === aId) || away;
            
            const statusDetail = String(sourceStatus?.type?.detail || sourceStatus?.type?.shortDetail || targetEvent.status?.type?.detail || 'Final');
            const isPastState = sourceStateKey === 'post' || /final/i.test(statusDetail);
            
            const getTeamAbbr = (teamObj) => {
                if (teamObj?.abbreviation) return teamObj.abbreviation;
                const nameStr = String(teamObj?.name || teamObj?.displayName || teamObj?.shortDisplayName || '').toLowerCase().trim();
                
                const aliases = {
                    'cavs': 'CLE', 'mavs': 'DAL', 'wolves': 'MIN', 'sixers': 'PHI', 
                    'blazers': 'POR', 'knicks': 'NY', 'nets': 'BKN', 'nuggets': 'DEN',
                    'nycfc': 'NYC', 'red bulls': 'NY', 'red bull new york': 'NY', 'sparks': 'LA', 'sun': 'CONN', 'valkyries': 'GS'
                };
                if (aliases[nameStr]) return aliases[nameStr];

                const found = AVAILABLE_TEAMS.find(t => {
                    const tName = t.name.toLowerCase();
                    if (tName === nameStr || nameStr.includes(tName) || (nameStr.length > 2 && (tName.endsWith(nameStr) || tName.startsWith(nameStr)))) return true;
                    const parts = tName.split(' ');
                    if (sport === 'soccer' && (nameStr.includes('red bull') || nameStr === 'rbny')) {
                        return t.id === 'mls-NY';
                    }

                    const mascot = parts[parts.length - 1];
                    const baseName = nameStr.endsWith('s') ? nameStr.slice(0, -1) : nameStr;
                    if (baseName.length >= 3 && (mascot.startsWith(baseName) || mascot.endsWith(baseName))) return true;
                    return false;
                });
                if (found) return found.abbr;
                if (teamObj?.shortDisplayName) return String(teamObj.shortDisplayName).substring(0, 3).toUpperCase();
                if (teamObj?.name) return String(teamObj.name).substring(0, 3).toUpperCase();
                return 'TBA';
            };

            const awayLogo = getLogoUrl(sourceAway.team || away.team);
            const homeLogo = getLogoUrl(sourceHome.team || home.team);
            let awayAbbrValue = getTeamAbbr(sourceAway.team || away.team);
            let homeAbbrValue = getTeamAbbr(sourceHome.team || home.team);
            const awayScoreValue = parseScore(sourceAway) !== "-" ? parseScore(sourceAway) : parseScore(away);
            const homeScoreValue = parseScore(sourceHome) !== "-" ? parseScore(sourceHome) : parseScore(home);
            let statusText = statusDetail;

            let awayWinner = false;
            let homeWinner = false;
            if (isPastState) {
                if (sourceAway.winner !== undefined && sourceAway.winner !== null) {
                    awayWinner = !!sourceAway.winner;
                    homeWinner = !!sourceHome.winner;
                } else if (away.winner !== undefined && away.winner !== null) {
                    awayWinner = !!away.winner;
                    homeWinner = !!home.winner;
                } else if (awayScoreValue !== '-' && homeScoreValue !== '-') {
                    const aScore = parseFloat(awayScoreValue);
                    const hScore = parseFloat(homeScoreValue);
                    if (aScore > hScore) awayWinner = true;
                    if (hScore > aScore) homeWinner = true;
                }
            }

            if (sourceStateKey === 'pre' && new Date(targetEvent.date).getTime() < Date.now()) {
                statusText = 'Awaiting Updates';
            }
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

                statusText = statusText.replace(/Bot(tom)?\s+/i, '▼ ').replace(/Top\s+/i, '▲ ');
            }

            let topPlayText = "Game update available.";
            let leaderName = "Player Stats";
            let leaderStats = "Awaiting Data";
            let leaderSubtext = "Current Game Stats";

            const isActionText = (text) => {
                if (!text) return false;
                const t = String(text).trim().toLowerCase();
                if (/^pitch \d+/i.test(t)) return false;
                const boringExacts = ['foul', 'foul tip', 'foul bunt', 'foul ball', 'ball', 'strike', 'called strike', 'swinging strike', 'strike swinging', 'strike looking'];
                if (boringExacts.includes(t)) return false;
                if (/^(strike|ball) \d$/.test(t)) return false;
                if (t.startsWith('pickoff') || t.startsWith('step off') || t.startsWith('pitchout')) return false;
                if (t.includes('pitches to')) return false;
                if (/^(top|bottom|middle|mid|end) of/i.test(t)) return false;
                if (t.includes('substitution') || t.includes('mound visit')) return false;
                return true;
            };

            const playFromSummary = (summary) => {
              if (!summary?.plays?.length) return null;
              const actionPlay = [...summary.plays].reverse().find(p => isActionText(p.text));
              return actionPlay ? actionPlay.text : null;
            };

            if (isLiveState) {
                const summaryLastPlayText = playFromSummary(summaryJson);
                if (summaryLastPlayText) {
                    topPlayText = summaryLastPlayText;
                } else if (currentSituation?.lastPlay?.text && isActionText(currentSituation.lastPlay.text)) {
                    topPlayText = currentSituation.lastPlay.text;
                } else if (comp.headlines && comp.headlines.length > 0) {
                    topPlayText = comp.headlines[0].shortLinkText || comp.headlines[0].description;
                }
            } else if (comp.headlines && comp.headlines.length > 0) {
                topPlayText = comp.headlines[0].shortLinkText || comp.headlines[0].description;
            }

            let playerSectionHeader = 'PLAYER OF THE GAME';
            let potgRunnerUps = [];

            try {
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
                      if (hits != null && abs != null) {
                          pieces.push(`${hits}/${abs} (${avg || '.000'})`);
                      } else if (hab) {
                          pieces.push(`${hab} (${avg || '.000'})`);
                      } else if (avg) {
                          pieces.push(`AVG: ${avg}`);
                      }
                      
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
                      let allCandidates = [];

                      const wpLeaderId = summaryJson?.leaders?.find(l => l.name === 'winningPitcher')?.leaders?.[0]?.athlete?.id 
                                      || comp?.leaders?.find(l => l.name === 'winningPitcher')?.leaders?.[0]?.athlete?.id;
                                      
                      const svLeaderId = summaryJson?.leaders?.find(l => l.name === 'saves')?.leaders?.[0]?.athlete?.id 
                                      || comp?.leaders?.find(l => l.name === 'saves')?.leaders?.[0]?.athlete?.id;

                      // --- MANUAL WPA CALCULATION ---
                      let manualWpaMap = {};
                      let hasWpaData = false;
                      
                      let wpMap = {};
                      if (summaryJson?.winprobability) {
                          summaryJson.winprobability.forEach(wp => {
                              if (wp.playId) wpMap[String(wp.playId)] = wp.homeWinPercentage;
                          });
                      }

                      if (summaryJson?.winprobability?.length > 0 || summaryJson?.plays?.some(p => p.probability)) {
                          hasWpaData = true;
                      }

                      if (hasWpaData && summaryJson?.plays?.length > 0) {
                          const homeId = String(sourceHome.team?.id || home.team?.id || sourceHome.id || home.id || '');
                          
                          // Pre-map athletes to their teams to reliably determine who is batting
                          let playerTeamMap = {};
                          summaryJson.boxscore.players.forEach(teamBox => {
                              const tId = String(teamBox.team?.id || '');
                              teamBox.statistics?.forEach(statBlock => {
                                  statBlock.athletes?.forEach(a => {
                                      if (a.athlete?.id) {
                                          playerTeamMap[String(a.athlete.id)] = tId;
                                          manualWpaMap[String(a.athlete.id)] = 0; // Initialize
                                      }
                                  });
                              });
                          });

                          let lastHomeWinPct = 0.5;
                          summaryJson.plays.forEach(play => {
                              let currentHomeWinPct = lastHomeWinPct;
                              const playId = String(play.id);
                              
                              let rawPct = null;
                              if (play.probability?.homeWinPercentage != null) {
                                  rawPct = play.probability.homeWinPercentage;
                              } else if (wpMap[playId] != null) {
                                  rawPct = wpMap[playId];
                              }

                              if (rawPct != null) {
                                  currentHomeWinPct = rawPct > 1.5 ? rawPct / 100 : rawPct;
                              }

                              const deltaHome = currentHomeWinPct - lastHomeWinPct;
                              
                              let batterId = null;
                              let pitcherId = null;
                              
                              if (play.matchup?.batter?.id) batterId = String(play.matchup.batter.id);
                              else if (play.matchup?.batter?.athlete?.id) batterId = String(play.matchup.batter.athlete.id);
                              
                              if (play.matchup?.pitcher?.id) pitcherId = String(play.matchup.pitcher.id);
                              else if (play.matchup?.pitcher?.athlete?.id) pitcherId = String(play.matchup.pitcher.athlete.id);

                              if (!batterId || !pitcherId) {
                                  if (play.participants) {
                                      const b = play.participants.find(p => p.type === 'batter' || p.participantType === 'batter');
                                      if (b) batterId = String(b.athlete?.id || b.id);
                                      const p = play.participants.find(p => p.type === 'pitcher' || p.participantType === 'pitcher');
                                      if (p) pitcherId = String(p.athlete?.id || p.id);
                                  }
                              }

                              const batterTeamId = batterId ? (playerTeamMap[batterId] || String(play.team?.id || '')) : String(play.team?.id || '');
                              // Fallback to inning status if batter isn't cleanly tied to a team
                              const isHomeBatting = batterTeamId ? (batterTeamId === homeId) : (String(play.period?.half || '').toLowerCase() === 'bottom' || play.about?.halfInning === 2);

                              const batterWpaDelta = isHomeBatting ? deltaHome : -deltaHome;
                              const pitcherWpaDelta = isHomeBatting ? -deltaHome : deltaHome;

                              if (batterId && deltaHome !== 0) {
                                  manualWpaMap[batterId] = (manualWpaMap[batterId] || 0) + batterWpaDelta;
                              }
                              if (pitcherId && deltaHome !== 0) {
                                  manualWpaMap[pitcherId] = (manualWpaMap[pitcherId] || 0) + pitcherWpaDelta;
                              }

                              lastHomeWinPct = currentHomeWinPct;
                          });
                      }

                      summaryJson.boxscore.players.forEach(teamBox => {
                          const teamAbbr = teamBox.team?.abbreviation || '';

                          teamBox.statistics?.forEach(statBlock => {
                              if (!statBlock.athletes) return;
                              const isBatting = statBlock.name === 'batting' || statBlock.type === 'batting';
                              const isPitching = statBlock.name === 'pitching' || statBlock.type === 'pitching';
                              if (!isBatting && !isPitching) return;

                              const labels = (statBlock.labels || statBlock.names || []).map(l => String(l).toUpperCase().trim());
                              const wpaIdx = labels.findIndex(l => l === 'WPA');
                              
                              const hrIdx = labels.findIndex(l => l === 'HR' || l === 'HOMERUNS');
                              const rbiIdx = labels.findIndex(l => l === 'RBI' || l === 'RBIS');
                              const rIdx = labels.findIndex(l => l === 'R' || l === 'RUNS');
                              const hIdx = labels.findIndex(l => l === 'H' || l === 'HITS');
                              const abIdx = labels.findIndex(l => l === 'AB' || l === 'ATBATS');
                              const dblIdx = labels.findIndex(l => l === '2B' || l === 'DOUBLES');
                              const tplIdx = labels.findIndex(l => l === '3B' || l === 'TRIPLES');
                              const sbIdx = labels.findIndex(l => l === 'SB' || l === 'STOLEN BASES');
                              
                              const ipIdx = labels.findIndex(l => l === 'IP');
                              const erIdx = labels.findIndex(l => l === 'ER' || l === 'EARNED RUNS');
                              const kIdx = labels.findIndex(l => l === 'K' || l === 'SO' || l === 'STRIKEOUTS');
                              const bbIdx = labels.findIndex(l => l === 'BB' || l === 'WALKS');
                              const npIdx = labels.findIndex(l => l === 'NP' || l === 'PC' || l === 'PITCHES');

                              statBlock.athletes.forEach(a => {
                                  if (!a.stats || a.didNotPlay) return;
                                  
                                  let currentWPA = null;
                                  const athleteId = String(a.athlete?.id);
                                  if (hasWpaData && manualWpaMap[athleteId] !== undefined) {
                                      currentWPA = manualWpaMap[athleteId];
                                  }
                                  
                                  // Fallback to ESPN's official WPA if manual logic yields 0 or is unavailable
                                  if ((currentWPA === null || currentWPA === 0) && wpaIdx > -1) {
                                      const wpaVal = parseFloat(a.stats[wpaIdx]);
                                      if (!isNaN(wpaVal)) currentWPA = wpaVal;
                                  }

                                  let baseScore = 0;
                                  let statsString = '';
                                  let subtext = '';

                                  if (isBatting) {
                                      const hr = hrIdx > -1 ? parseInt(a.stats[hrIdx], 10) || 0 : 0;
                                      const rbi = rbiIdx > -1 ? parseInt(a.stats[rbiIdx], 10) || 0 : 0;
                                      const runs = rIdx > -1 ? parseInt(a.stats[rIdx], 10) || 0 : 0;
                                      const hits = hIdx > -1 ? parseInt(a.stats[hIdx], 10) || 0 : 0;
                                      const abs = abIdx > -1 ? parseInt(a.stats[abIdx], 10) || 0 : 0;
                                      const dbl = dblIdx > -1 ? parseInt(a.stats[dblIdx], 10) || 0 : 0;
                                      const tpl = tplIdx > -1 ? parseInt(a.stats[tplIdx], 10) || 0 : 0;
                                      const sb = sbIdx > -1 ? parseInt(a.stats[sbIdx], 10) || 0 : 0;
                                      const bbBatter = bbIdx > -1 ? parseInt(a.stats[bbIdx], 10) || 0 : 0;

                                      // Re-tuned hitter weights to be more competitive against pitcher scores
                                      baseScore = (hr * 4.5) + (tpl * 3) + (dbl * 2) + (rbi * 2.2) + (runs * 1.2) + (hits * 1.5) + sb + bbBatter;
                                      
                                      let notableStats = [];
                                      if (hr > 0) notableStats.push(`HR: ${hr}`);
                                      if (tpl > 0) notableStats.push(`3B: ${tpl}`);
                                      if (dbl > 0) notableStats.push(`2B: ${dbl}`);
                                      if (rbi > 0) notableStats.push(`RBI: ${rbi}`);
                                      if (runs > 0) notableStats.push(`R: ${runs}`);
                                      if (sb > 0) notableStats.push(`SB: ${sb}`);
                                      if (bbBatter > 0) notableStats.push(`BB: ${bbBatter}`);

                                      // Build a compact batting line with optional doubles/triples only if there's room.
                                      const avgIdx = labels.findIndex(l => l === 'AVG');
                                      const avgStr = avgIdx > -1 ? a.stats[avgIdx] : '.000';
                                      const baseBatter = `${hits}/${abs} (${avgStr})`;
                                      const maxChars = isTablet ? 78 : 52; // heuristic for single-line stat budget

                                      const segments = [];
                                      segments.push(baseBatter);

                                      // Valuables that almost always fit / matter more
                                      if (hr > 0) segments.push(`HR: ${hr}`);
                                      if (rbi > 0) segments.push(`RBI: ${rbi}`);
                                      if (runs > 0) segments.push(`R: ${runs}`);
                                      if (sb > 0) segments.push(`SB: ${sb}`);
                                      if (bbBatter > 0) segments.push(`BB: ${bbBatter}`);

                                      // Add triples first (rarer, usually more valuable), then doubles.
                                      // Only include if it still fits in the budget.
                                      const tryAdd = (label) => {
                                          const candidate = [...segments, label].join('  |  ');
                                          if (candidate.length <= maxChars) {
                                              segments.push(label);
                                              return true;
                                          }
                                          return false;
                                      };

                                      if (tpl > 0) {
                                          tryAdd(`3B: ${tpl}`);
                                      }
                                      if (dbl > 0) {
                                          // Doubles are shown when they can fit and are at least somewhat meaningful.
                                          // (Threshold tuned to avoid noise.)
                                          if (dbl >= (isTablet ? 2 : 3)) {
                                              tryAdd(`2B: ${dbl}`);
                                          } else {
                                              // On smaller budgets, skip 1-double unless it still fits.
                                              tryAdd(`2B: ${dbl}`);
                                          }
                                      }

                                      statsString = segments.join('  |  ');
                                      subtext = "Top Batter";
                                  } else if (isPitching) {
                                      const ip = ipIdx > -1 ? a.stats[ipIdx] : '0.0';
                                      
                                      // Parse fractional innings accurately (e.g. 6.1 = 6.33 innings)
                                      let ipParts = String(ip).split('.');
                                      let ipFloat = parseInt(ipParts[0], 10) || 0;
                                      if (ipParts[1]) ipFloat += (parseInt(ipParts[1], 10) / 3);
                                      
                                      const er = erIdx > -1 ? parseInt(a.stats[erIdx], 10) || 0 : 0;
                                      const k = kIdx > -1 ? parseInt(a.stats[kIdx], 10) || 0 : 0;
                                      const bb = bbIdx > -1 ? parseInt(a.stats[bbIdx], 10) || 0 : 0;
                                      const rPitch = rIdx > -1 ? parseInt(a.stats[rIdx], 10) || 0 : 0;
                                      const hPitch = hIdx > -1 ? parseInt(a.stats[hIdx], 10) || 0 : 0;
                                      const np = npIdx > -1 ? parseInt(a.stats[npIdx], 10) || 0 : 0;

                                      baseScore = (ipFloat * 3) + (k * 2.5) - (er * 3.5) - (bb * 1.2);
                                      const maxChars = isTablet ? 78 : 52; // heuristic for single-line stat budget

                                      const basePitch = `IP: ${ip}  |  ER: ${er}  |  H: ${hPitch}  |  BB/K: ${bb}/${k}`;
                                      let candidatePitch = basePitch;

                                      // Only append NP if it fits in the available single-line budget.
                                      if (np > 0) {
                                          const withNp = `${basePitch}  |  P:${np}`;
                                          if (withNp.length <= maxChars) candidatePitch = withNp;
                                      }

                                      statsString = candidatePitch;
                                      
                                      const athleteIdStr = String(a.athlete?.id);
                                      if (wpLeaderId && String(wpLeaderId) === athleteIdStr) {
                                          subtext = "Winning Pitcher";
                                          baseScore += 6;
                                      } else if (svLeaderId && String(svLeaderId) === athleteIdStr) {
                                          subtext = "Earned Save";
                                          baseScore += 5;
                                      } else {
                                          subtext = "Top Pitcher";
                                      }
                                  }

                                  // --- THE MVP HYBRID FORMULA ---
                                  // A full WPA win is worth 30 points (so a clutch 0.33 WPA adds 10 points to their base stats)
                                  const wpaBonus = currentWPA !== null ? (currentWPA * 30) : 0;
                                  
                                  // Winning team bias: give a 25% boost to players on the winning team
                                  let teamWinMultiplier = 1;
                                  const isHomeTeam = teamAbbr === homeAbbrValue || teamAbbr === sourceHome.team?.abbreviation;
                                  const homeWon = parseInt(homeScoreValue, 10) > parseInt(awayScoreValue, 10);
                                  const awayWon = parseInt(awayScoreValue, 10) > parseInt(homeScoreValue, 10);
                                  if ((isHomeTeam && homeWon) || (!isHomeTeam && awayWon)) {
                                      teamWinMultiplier = 1.25;
                                  }
                                  
                                  const mvpScore = (baseScore + wpaBonus) * teamWinMultiplier;

                                  allCandidates.push({ a, teamAbbr, statsString, subtext, wpa: currentWPA, baseScore, mvpScore });
                              });
                          });
                      });

                      allCandidates.sort((c1, c2) => {
                          return c2.mvpScore - c1.mvpScore;
                      });

                      if (allCandidates.length > 0) {
                          const finalPlayer = allCandidates[0];
                          const name = finalPlayer.a.athlete?.shortName || finalPlayer.a.athlete?.displayName || 'Player';

                          leaderName = finalPlayer.teamAbbr ? `${name} (${finalPlayer.teamAbbr})` : name;
                          leaderSubtext = `${finalPlayer.subtext} • MVP Score: ${finalPlayer.mvpScore.toFixed(1)}`;
                          leaderStats = finalPlayer.statsString;

                          potgRunnerUps = allCandidates.slice(1, 4).map(c => ({
                              name: c.a.athlete?.shortName || c.a.athlete?.displayName || 'Player',
                              teamAbbr: c.teamAbbr,
                              stats: c.statsString,
                              mvpScore: c.mvpScore.toFixed(1)
                          }));
                      }
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
              else if (league === 'nba' || league === 'wnba') {
                  let allNbaCandidates = [];
                  if (Array.isArray(summaryJson?.boxscore?.players)) {
                      summaryJson.boxscore.players.forEach(teamBox => {
                          const stats = teamBox.statistics?.[0]; 
                          if (stats && Array.isArray(stats.athletes)) {
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
                                  
                                  if (score > 0) {
                                      allNbaCandidates.push({
                                          name: a.athlete?.shortName || a.athlete?.displayName || "Player",
                                          teamAbbr: teamBox.team?.abbreviation || "",
                                          stats: `PTS: ${pts}  |  REB: ${reb}  |  AST: ${ast}`,
                                          score: score
                                      });
                                  }
                              });
                          }
                      });
                  }

                  allNbaCandidates.sort((a, b) => b.score - a.score);

                  if (allNbaCandidates.length > 0) {
                      const top = allNbaCandidates[0];
                      leaderName = top.teamAbbr ? `${top.name} (${top.teamAbbr})` : top.name;
                      leaderSubtext = "Game Leader";
                      leaderStats = top.stats;
                      
                      potgRunnerUps = allNbaCandidates.slice(1, 4).map(c => ({
                          name: c.name,
                          teamAbbr: c.teamAbbr,
                          stats: c.stats,
                          mvpScore: c.score
                      }));
                  }
              }
              else if (league === 'nhl') {
                  let firstStarAthlete = null;
                  let firstStarDisplay = null;

                  // 1. Always prioritize the official First Star to prevent unneeded goalie/skater defaults
                  if (Array.isArray(summaryJson?.threeStars) && summaryJson.threeStars.length > 0) {
                      firstStarAthlete = summaryJson.threeStars[0]?.athlete;
                      firstStarDisplay = summaryJson.threeStars[0]?.displayValue;
                  } else {
                      const allLeaders = [
                          ...(Array.isArray(summaryJson?.leaders) ? summaryJson.leaders : []), 
                          ...(Array.isArray(comp.leaders) ? comp.leaders : []),
                          ...(Array.isArray(comp.status?.featuredAthletes) ? comp.status.featuredAthletes : []),
                          ...(Array.isArray(summaryJson?.header?.competitions?.[0]?.status?.featuredAthletes) ? summaryJson.header.competitions[0].status.featuredAthletes : [])
                      ];
                      const firstStarLeader = allLeaders.find(l => 
                          String(l.name).toLowerCase() === 'firststar' || 
                          String(l.displayName).toLowerCase().includes('first star') || 
                          String(l.shortDisplayName).toLowerCase().includes('1st star')
                      );
                      if (firstStarLeader) {
                          const leaderEntry = firstStarLeader.leaders?.[0] || firstStarLeader;
                          firstStarAthlete = leaderEntry.athlete || leaderEntry.player;
                          firstStarDisplay = leaderEntry.displayValue || leaderEntry.value || "Standout Performer";
                      }
                  }

                  const findNhlPlayerStats = (athlete) => {
                      if (!athlete) return null;
                      const targetId = String(athlete.id || '');
                      const targetName = String(athlete.shortName || athlete.displayName || '');
                      if (!targetId && !targetName) return null;

                      if (Array.isArray(summaryJson?.boxscore?.players)) {
                          for (const teamBox of summaryJson.boxscore.players) {
                              const isGoalieBlock = (s) => {
                                  if (!s) return false;
                                  const name = s.name?.toLowerCase();
                                  if (name?.includes('goalie') || name?.includes('goaltending')) return true;
                                  const labels = (s.labels || s.names || []).map(l => String(l).toUpperCase().trim());
                                  return labels.includes('SV') || labels.includes('GA');
                              };
                              const skaterStats = teamBox.statistics?.find(s => !isGoalieBlock(s));

                              if (skaterStats && skaterStats.athletes) {
                                  const playerMatch = skaterStats.athletes.find(a => 
                                      (targetId && String(a.athlete?.id) === targetId) || 
                                      (targetName && (a.athlete?.shortName === targetName || a.athlete?.displayName === targetName))
                                  );
                                  if (playerMatch && playerMatch.stats && !playerMatch.didNotPlay) {
                                      const labels = (skaterStats.labels || skaterStats.names || []).map(l => String(l).toUpperCase().trim());
                                      const gIdx = labels.findIndex(l => l === 'G' || l === 'GOALS');
                                      const aIdx = labels.findIndex(l => l === 'A' || l === 'ASSISTS');
                                      const ptsIdx = labels.findIndex(l => l === 'PTS' || l === 'POINTS');
                                      const sogIdx = labels.findIndex(l => l === 'SOG' || l === 'S' || l === 'SHOTS');

                                      const g = gIdx > -1 ? parseInt(playerMatch.stats[gIdx], 10) || 0 : 0;
                                      const ast = aIdx > -1 ? parseInt(playerMatch.stats[aIdx], 10) || 0 : 0;
                                      let pts = ptsIdx > -1 ? parseInt(playerMatch.stats[ptsIdx], 10) || 0 : 0;
                                      if (pts === 0 && (g > 0 || ast > 0)) pts = g + ast;
                                      const sog = sogIdx > -1 ? parseInt(playerMatch.stats[sogIdx], 10) || 0 : 0;

                                      return `G: ${g}  |  A: ${ast}  |  PTS: ${pts}  |  SOG: ${sog}`;
                                  }
                              }
                              
                              const goalieStats = teamBox.statistics?.find(isGoalieBlock);
                              if (goalieStats && goalieStats.athletes) {
                                  const playerMatch = goalieStats.athletes.find(a => 
                                      (targetId && String(a.athlete?.id) === targetId) || 
                                      (targetName && (a.athlete?.shortName === targetName || a.athlete?.displayName === targetName))
                                  );
                                  if (playerMatch && playerMatch.stats && !playerMatch.didNotPlay) {
                                      const labels = (goalieStats.labels || goalieStats.names || []).map(l => String(l).toUpperCase().trim());
                                      const svIdx = labels.findIndex(l => l === 'SV' || l === 'SAVES');
                                      const saIdx = labels.findIndex(l => l === 'SA' || l === 'SHOTS' || l === 'SHOTS AGAINST');
                                      const svPctIdx = labels.findIndex(l => l === 'SV%' || l === 'PCT' || l === 'SAVE PCT');

                                      const sv = svIdx > -1 ? playerMatch.stats[svIdx] : 0;
                                      const sa = saIdx > -1 ? playerMatch.stats[saIdx] : 0;
                                      const svPct = svPctIdx > -1 ? playerMatch.stats[svPctIdx] : '.000';

                                      return `SV: ${sv}  |  SA: ${sa}  |  SV%: ${svPct}`;
                                  }
                              }
                          }
                      }
                      return null;
                  };

                  if (firstStarAthlete) {
                      leaderName = firstStarAthlete.shortName || firstStarAthlete.displayName || "1st Star";
                      leaderSubtext = "1st Star of the Game";
                      let computedStats = firstStarDisplay;

                      if (!computedStats || computedStats === "Standout Performer") {
                          const foundStats = findNhlPlayerStats(firstStarAthlete);
                          if (foundStats) computedStats = foundStats;
                      }

                      leaderStats = computedStats || "Standout Performer";
                      
                      if (Array.isArray(summaryJson?.threeStars) && summaryJson.threeStars.length > 1) {
                          potgRunnerUps = summaryJson.threeStars.slice(1, 4).map((star, idx) => {
                              const sAthlete = star.athlete || {};
                              const sName = sAthlete.shortName || sAthlete.displayName || star.displayValue || `Star ${idx+2}`;
                              let sStats = star.displayValue && star.displayValue !== sName ? star.displayValue : null;
                              
                              if (!sStats || sStats === "Standout Performer") {
                                  const foundStats = findNhlPlayerStats(sAthlete);
                                  if (foundStats) sStats = foundStats;
                              }
                              
                              return {
                                  name: sName,
                                  teamAbbr: '',
                                  stats: sStats || 'Standout Performer',
                                  mvpScore: `${idx + 2}nd Star`
                              };
                          });
                      } else {
                          const allLeadersLocal = [
                              ...(Array.isArray(summaryJson?.leaders) ? summaryJson.leaders : []), 
                              ...(Array.isArray(comp.leaders) ? comp.leaders : []),
                              ...(Array.isArray(comp.status?.featuredAthletes) ? comp.status.featuredAthletes : []),
                              ...(Array.isArray(summaryJson?.header?.competitions?.[0]?.status?.featuredAthletes) ? summaryJson.header.competitions[0].status.featuredAthletes : [])
                          ];
                          
                          const star2 = allLeadersLocal.find(l => String(l.name).toLowerCase() === 'secondstar' || String(l.displayName).toLowerCase().includes('second star') || String(l.shortDisplayName).toLowerCase().includes('2nd star'));
                          const star3 = allLeadersLocal.find(l => String(l.name).toLowerCase() === 'thirdstar' || String(l.displayName).toLowerCase().includes('third star') || String(l.shortDisplayName).toLowerCase().includes('3rd star'));
                          
                          const extraStars = [];
                          if (star2) extraStars.push(star2);
                          if (star3) extraStars.push(star3);
                          
                          if (extraStars.length > 0) {
                              potgRunnerUps = extraStars.map((starCat, idx) => {
                                  const leaderEntry = starCat.leaders?.[0] || starCat;
                                  const sAthlete = leaderEntry.athlete || leaderEntry.player || {};
                                  const sName = sAthlete.shortName || sAthlete.displayName || leaderEntry.displayValue || leaderEntry.value || `Star ${idx+2}`;
                                  let sStats = (leaderEntry.displayValue || leaderEntry.value) && (leaderEntry.displayValue || leaderEntry.value) !== sName ? (leaderEntry.displayValue || leaderEntry.value) : null;
                                  
                                  if (!sStats || sStats === "Standout Performer") {
                                      const foundStats = findNhlPlayerStats(sAthlete);
                                      if (foundStats) sStats = foundStats;
                                  }
                                  
                                  return {
                                      name: sName,
                                      teamAbbr: '',
                                      stats: sStats || 'Standout Performer',
                                      mvpScore: `${idx + 2}nd Star`
                                  };
                              });
                          }
                      }
                  } else {
                      // 2. Fallback to manually finding the top skater or goalie
                      let allNhlCandidates = [];

                      if (Array.isArray(summaryJson?.boxscore?.players)) {
                          summaryJson.boxscore.players.forEach(teamBox => {
                              const teamAbbr = teamBox.team?.abbreviation || "";

                              const isGoalieBlock = (s) => {
                                  if (!s) return false;
                                  const name = s.name?.toLowerCase();
                                  if (name?.includes('goalie') || name?.includes('goaltending')) return true;
                                  const labels = (s.labels || s.names || []).map(l => String(l).toUpperCase().trim());
                                  return labels.includes('SV') || labels.includes('GA');
                              };
                              const skaterStats = teamBox.statistics?.find(s => !isGoalieBlock(s));

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
                                      let pts = ptsIdx > -1 ? parseInt(a.stats[ptsIdx], 10) || 0 : 0;
                                      if (pts === 0 && (g > 0 || ast > 0)) pts = g + ast;
                                      const sog = sogIdx > -1 ? parseInt(a.stats[sogIdx], 10) || 0 : 0;
                                      const score = (g * 10) + (ast * 5) + (pts * 5) + sog;
                                      
                                      if (score > 0) {
                                          allNhlCandidates.push({
                                              name: a.athlete?.shortName || a.athlete?.displayName || "Player",
                                              teamAbbr,
                                              stats: `G: ${g}  |  A: ${ast}  |  PTS: ${pts}  |  SOG: ${sog}`,
                                              score
                                          });
                                      }
                                  });
                              }
                          });
                      }

                      allNhlCandidates.sort((a, b) => b.score - a.score);

                      if (allNhlCandidates.length > 0) {
                          const top = allNhlCandidates[0];
                          leaderName = top.teamAbbr ? `${top.name} (${top.teamAbbr})` : top.name;
                          leaderSubtext = "Top Skater";
                          leaderStats = top.stats;
                          
                          potgRunnerUps = allNhlCandidates.slice(1, 4).map(c => ({
                              name: c.name,
                              teamAbbr: c.teamAbbr,
                              stats: c.stats,
                              mvpScore: c.score
                          }));
                      }
                  }
              }
              else if (league === 'nfl' || league === 'college-football' || league === 'ncaaf') {
                  if (Array.isArray(summaryJson?.boxscore?.players)) {
                      let allNflCandidates = [];
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
          
                                      if (score > 0) {
                                          const name = a.athlete?.shortName || a.athlete?.displayName || "Player";
                                          const teamAbbr = teamBox.team?.abbreviation || "";
                                          allNflCandidates.push({
                                              name,
                                              teamAbbr,
                                              subtext: `Top ${statType.charAt(0).toUpperCase() + statType.slice(1)}`,
                                              stats: `YDS: ${yds}  |  TD: ${tds}`,
                                              score
                                          });
                                      }
                                  });
                              }
                          });
                      });

                      allNflCandidates.sort((a, b) => b.score - a.score);
                      let dedupNfl = [];
                      let seenNames = new Set();
                      for (const c of allNflCandidates) {
                          if (!seenNames.has(c.name)) {
                              seenNames.add(c.name);
                              dedupNfl.push(c);
                          }
                      }

                      if (dedupNfl.length > 0) {
                          const top = dedupNfl[0];
                          leaderName = top.teamAbbr ? `${top.name} (${top.teamAbbr})` : top.name;
                          leaderSubtext = top.subtext;
                          leaderStats = top.stats;

                          potgRunnerUps = dedupNfl.slice(1, 4).map(c => ({
                              name: c.name,
                              teamAbbr: c.teamAbbr,
                              stats: c.stats,
                              mvpScore: c.score
                          }));
                      }
                  }
              }
              else if (sport === 'soccer') {
                  let allSoccerCandidates = [];

                  // 1. Try Boxscore (sometimes ESPN uses it for soccer)
                  if (Array.isArray(summaryJson?.boxscore?.players)) {
                      summaryJson.boxscore.players.forEach(teamBox => {
                          const teamAbbr = teamBox.team?.abbreviation || "";
                          teamBox.statistics?.forEach(statBlock => {
                              if (statBlock.athletes && Array.isArray(statBlock.athletes)) {
                                  const labels = (statBlock.labels || statBlock.names || []).map(l => String(l).toUpperCase().trim());
                                  const gIdx = labels.findIndex(l => l === 'G' || l === 'GOALS');
                                  const aIdx = labels.findIndex(l => l === 'A' || l === 'ASSISTS');
                                  const shIdx = labels.findIndex(l => l === 'SH' || l === 'SHOTS');
                                  const svIdx = labels.findIndex(l => l === 'SV' || l === 'SAVES');

                                  statBlock.athletes.forEach(a => {
                                      if (!a.stats || a.didNotPlay) return;
                                      const g = gIdx > -1 ? parseInt(a.stats[gIdx], 10) || 0 : 0;
                                      const ast = aIdx > -1 ? parseInt(a.stats[aIdx], 10) || 0 : 0;
                                      const sh = shIdx > -1 ? parseInt(a.stats[shIdx], 10) || 0 : 0;
                                      const sv = svIdx > -1 ? parseInt(a.stats[svIdx], 10) || 0 : 0;

                                      let score = (g * 10) + (ast * 5) + (sh * 1) + (sv * 3);

                                      if (score > 0) {
                                          const name = a.athlete?.shortName || a.athlete?.displayName || "Player";
                                          let statsStr = '';
                                          let subtext = '';
                                          if (svIdx > -1 && (sv > 0 || (g === 0 && ast === 0 && sh === 0))) {
                                              statsStr = `SV: ${sv}  |  G: ${g}  |  A: ${ast}`;
                                              subtext = "Top Goalkeeper";
                                          } else {
                                              statsStr = `G: ${g}  |  A: ${ast}  |  SH: ${sh}`;
                                              subtext = "Top Performer";
                                          }
                                          allSoccerCandidates.push({ name, teamAbbr, subtext, stats: statsStr, score });
                                      }
                                  });
                              }
                          });
                      });
                  }

                  // 2. Try Roster (ESPN standard for soccer)
                  if (allSoccerCandidates.length === 0 && Array.isArray(summaryJson?.roster)) {
                      summaryJson.roster.forEach(teamRoster => {
                          const teamAbbr = teamRoster.team?.abbreviation || "";
                          const labels = (teamRoster.labels || teamRoster.names || []).map(l => String(l).toUpperCase().trim());
                          const gIdx = labels.findIndex(l => l === 'G' || l === 'GOALS');
                          const aIdx = labels.findIndex(l => l === 'A' || l === 'ASSISTS');
                          const shIdx = labels.findIndex(l => l === 'SH' || l === 'SHOTS');
                          const svIdx = labels.findIndex(l => l === 'SV' || l === 'SAVES');

                          if (Array.isArray(teamRoster.roster)) {
                              teamRoster.roster.forEach(r => {
                                  if (!r.stats || !Array.isArray(r.stats)) return;
                                  const a = r.athlete || {};
                                  
                                  const g = gIdx > -1 ? parseInt(r.stats[gIdx], 10) || 0 : 0;
                                  const ast = aIdx > -1 ? parseInt(r.stats[aIdx], 10) || 0 : 0;
                                  const sh = shIdx > -1 ? parseInt(r.stats[shIdx], 10) || 0 : 0;
                                  const sv = svIdx > -1 ? parseInt(r.stats[svIdx], 10) || 0 : 0;
                                  
                                  let score = (g * 10) + (ast * 5) + (sh * 1) + (sv * 3);
                                  
                                  if (score > 0) {
                                      const name = a.shortName || a.displayName || "Player";
                                      let statsStr = '';
                                      let subtext = '';
                                      if (svIdx > -1 && (sv > 0 || (g === 0 && ast === 0 && sh === 0))) {
                                          statsStr = `SV: ${sv}  |  G: ${g}  |  A: ${ast}`;
                                          subtext = "Top Goalkeeper";
                                      } else {
                                          statsStr = `G: ${g}  |  A: ${ast}  |  SH: ${sh}`;
                                          subtext = "Top Performer";
                                      }
                                      allSoccerCandidates.push({ name, teamAbbr, subtext, stats: statsStr, score });
                                  }
                              });
                          }
                      });
                  }
                  
                  // 3. Try Key Events (Goals)
                  if (allSoccerCandidates.length === 0 && Array.isArray(summaryJson?.keyEvents)) {
                      const playerScores = {};
                      summaryJson.keyEvents.forEach(evt => {
                          const type = String(evt.type?.text || '').toLowerCase();
                          if (type.includes('goal') && !type.includes('own goal')) {
                              const participants = evt.participants || [];
                              const scorer = participants.find(p => p.type === 'scorer' || !p.type) || participants[0];
                              if (scorer && scorer.athlete) {
                                  const aId = String(scorer.athlete.id);
                                  if (!playerScores[aId]) {
                                      playerScores[aId] = {
                                          name: scorer.athlete.shortName || scorer.athlete.displayName || "Player",
                                          teamAbbr: evt.team?.abbreviation || "",
                                          g: 0,
                                          ast: 0
                                      };
                                  }
                                  playerScores[aId].g += 1;
                              }
                          }
                      });
                      
                      Object.values(playerScores).forEach(p => {
                          const score = (p.g * 10);
                          if (score > 0) {
                              allSoccerCandidates.push({
                                  name: p.name,
                                  teamAbbr: p.teamAbbr,
                                  subtext: "Goal Scorer",
                                  stats: `G: ${p.g}  |  A: ${p.ast}`,
                                  score: score
                              });
                          }
                      });
                  }

                  if (allSoccerCandidates.length > 0) {
                      allSoccerCandidates.sort((a, b) => b.score - a.score);
                      let dedupSoccer = [];
                      let seenNames = new Set();
                      for (const c of allSoccerCandidates) {
                          if (!seenNames.has(c.name)) {
                              seenNames.add(c.name);
                              dedupSoccer.push(c);
                          }
                      }

                      const top = dedupSoccer[0];
                      leaderName = top.teamAbbr ? `${top.name} (${top.teamAbbr})` : top.name;
                      leaderSubtext = top.subtext;
                      leaderStats = top.stats;

                      potgRunnerUps = dedupSoccer.slice(1, 4).map(c => ({
                          name: c.name,
                          teamAbbr: c.teamAbbr,
                          stats: c.stats,
                          mvpScore: c.score
                      }));
                  }
              }

              if (leaderStats === "Awaiting Data" || leaderStats.includes("Awaiting")) {
                 let bestCat = null;
                 const leaderSources = [summaryJson?.leaders, comp.leaders];
                 
                 for (const source of leaderSources) {
                     if (Array.isArray(source) && source.length > 0) {
                         bestCat = source.find(l => {
                             if (!l) return false;
                             const a = l.leaders?.[0]?.athlete || l.leaders?.[0]?.player;
                             if (!a || !(a.displayName || a.shortName || a.fullName)) return false;
                             return ['firstStar', 'points', 'goals', 'passingYards', 'homeRuns', 'wins'].includes(l.name);
                         }) || source.find(l => {
                             if (!l) return false;
                             const a = l.leaders?.[0]?.athlete || l.leaders?.[0]?.player;
                             if (!a || !(a.displayName || a.shortName || a.fullName)) return false;
                             return !['winningGoalie', 'losingGoalie', 'winningPitcher', 'losingPitcher', 'saves'].includes(l.name);
                         }) || source.find(l => {
                             if (!l) return false;
                             const a = l.leaders?.[0]?.athlete || l.leaders?.[0]?.player;
                             return a && (a.displayName || a.shortName || a.fullName);
                         });
                         
                         if (bestCat) break;
                     }
                 }
                 
                 if (bestCat?.leaders?.[0]) {
                     const leaderObj = bestCat.leaders[0];
                     const athlete = leaderObj.athlete || leaderObj.player || {};
                     const name = athlete.displayName || athlete.shortName || athlete.fullName;
                     
                     if (name) {
                         leaderName = name;
                         leaderSubtext = "Game Leader";
                         leaderStats = `${bestCat.displayName || bestCat.shortDisplayName || bestCat.name || 'Stat'}: ${leaderObj.displayValue || leaderObj.value || '1'}`;
                     }
                 } else if (topPlayText && topPlayText !== "Game update available." && state !== 'in') {
                     leaderName = "GAME HIGHLIGHT";
                     leaderSubtext = "Top Story";
                     leaderStats = topPlayText;
                 }
              }
            } catch(summaryErr) {
              if (Array.isArray(comp.leaders) && comp.leaders.length > 0) {
                 const bestLeader = comp.leaders.find(l => {
                     if (!l) return false;
                     const a = l.leaders?.[0]?.athlete || l.leaders?.[0]?.player;
                     return a && (a.displayName || a.shortName || a.fullName) && l.name === 'firstStar';
                 }) || comp.leaders.find(l => {
                     if (!l) return false;
                     const a = l.leaders?.[0]?.athlete || l.leaders?.[0]?.player;
                     return a && (a.displayName || a.shortName || a.fullName) && !['winningGoalie', 'losingGoalie', 'winningPitcher', 'losingPitcher', 'saves'].includes(l.name);
                 }) || comp.leaders.find(l => {
                     if (!l) return false;
                     const a = l.leaders?.[0]?.athlete || l.leaders?.[0]?.player;
                     return a && (a.displayName || a.shortName || a.fullName);
                 });

                 if (bestLeader?.leaders?.[0]) {
                     const leaderObj = bestLeader.leaders[0];
                     const athlete = leaderObj.athlete || leaderObj.player || {};
                     const name = athlete.displayName || athlete.shortName || athlete.fullName;
                     if (name) {
                         leaderName = name;
                         leaderStats = `${bestLeader.displayName || bestLeader.shortDisplayName || bestLeader.name || 'Stat'}: ${leaderObj.displayValue || leaderObj.value || 'Stats Unavailable'}`;
                     }
                 }
              }
            }

            if (topPlayText === "Game update available." && leaderName !== "Player Stats" && leaderName !== "GAME HIGHLIGHT") {
                topPlayText = state === 'in' ? 'Live updates currently unavailable.' : `${leaderName} led the game.`;
            }

            const getNextGameString = async (teamIdStr) => {
                if (!teamIdStr) return "Schedule TBA";
                try {
                    const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamIdStr}/schedule`, { headers: fetchHeaders });
                    if (!res.ok) return "Schedule TBA";
                    const json = await res.json();
                    let evs = json.events || [];
                    const nowMs = Date.now();
                    let upcoming = evs.filter(ev => {
                        const st = ev.competitions?.[0]?.status?.type?.state;
                        if (st === 'post' || st === 'in') return false;
                        return new Date(ev.date).getTime() > nowMs;
                    });
                    
                    // If schedule is empty (e.g. a soccer cup match), try the team's root nextEvent
                    if (upcoming.length === 0) {
                        const teamRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${teamIdStr}`, { headers: fetchHeaders });
                        if (teamRes.ok) {
                            const teamJson = await teamRes.json();
                            if (teamJson.team?.nextEvent?.length > 0) {
                                upcoming = teamJson.team.nextEvent.filter(ev => {
                                    const st = ev.competitions?.[0]?.status?.type?.state;
                                    return st !== 'post' && st !== 'in' && new Date(ev.date).getTime() > nowMs;
                                });
                            }
                        }
                    }

                    if (upcoming.length === 0) return "Schedule TBA";
                    upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
                    const nextEv = upcoming[0];
                    if (nextEv.status?.type?.name === 'STATUS_TBD' || nextEv.status?.type?.name === 'STATUS_UNCONTESTED') {
                        return "Time & Date TBD";
                    }
                    const nextDate = new Date(nextEv.date);
                    const isToday = nextDate.toDateString() === new Date().toDateString();
                    const dateFmt = isToday ? "Today" : nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    const timeFmt = nextDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    return `${dateFmt} at ${timeFmt}`;
                } catch (e) {
                    return "Schedule TBA";
                }
            };

            const homeIdStr = home.team?.id || home.team?.abbreviation;
            let homeRecord = '';
            let homeNextGame = 'Schedule TBA';
            let homeTeamJson = null;
            if (home.team?.abbreviation === abbr || home.team?.id === teamJson.team?.id) {
              homeRecord = record;
              homeTeamJson = teamJson;
            } else {
              try {
                const homeRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${homeIdStr}`, { headers: fetchHeaders });
                if (homeRes.ok) {
                  homeTeamJson = await homeRes.json();
                  homeRecord = homeTeamJson.team?.record?.items?.[0]?.summary || home.team?.record?.items?.[0]?.summary || '';
                } else {
                  homeRecord = home.team?.record?.items?.[0]?.summary || '';
                }
              } catch (e) {
                homeRecord = home.team?.record?.items?.[0]?.summary || '';
              }
            }
            homeNextGame = await getNextGameString(homeIdStr);

            const awayIdStr = away.team?.id || away.team?.abbreviation;
            let awayRecord = '';
            let awayNextGame = 'Schedule TBA';
            let awayTeamJson = null;
            if (away.team?.abbreviation === abbr || away.team?.id === teamJson.team?.id) {
              awayRecord = record;
              awayTeamJson = teamJson;
            } else {
              try {
                const awayRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/teams/${awayIdStr}`, { headers: fetchHeaders });
                if (awayRes.ok) {
                  awayTeamJson = await awayRes.json();
                  awayRecord = awayTeamJson.team?.record?.items?.[0]?.summary || away.team?.record?.items?.[0]?.summary || '';
                } else {
                  awayRecord = away.team?.record?.items?.[0]?.summary || '';
                }
              } catch (e) {
                awayRecord = away.team?.record?.items?.[0]?.summary || '';
              }
            }
            awayNextGame = await getNextGameString(awayIdStr);

            homeAbbrValue = homeAbbrValue !== 'TBA' ? homeAbbrValue : (homeTeamJson?.team?.abbreviation || getTeamAbbr(sourceHome.team || home.team));
            awayAbbrValue = awayAbbrValue !== 'TBA' ? awayAbbrValue : (awayTeamJson?.team?.abbreviation || getTeamAbbr(sourceAway.team || away.team));

            // --- PLAYOFF OVERRIDES ---
            const seasonTypeStr = String(targetEvent.season?.type || targetEvent.seasonType?.type || comp.season?.type || summaryJson?.header?.season?.type || '2');
            const hasSeries = (comp.series != null || summaryComp?.series != null || targetEvent.series != null);
            
            const explicitEventSeason = String(targetEvent.season?.type || targetEvent.seasonType?.type || comp.season?.type || '0');
            const isPlayoff = explicitEventSeason !== '2' && (seasonTypeStr === '3' || (league !== 'mlb' && hasSeries) || (league === 'mlb' && targetEvent.notes?.[0]?.headline?.toLowerCase().includes('playoff')));

            if (isPlayoff) {
                const seriesTitle = summaryComp?.series?.title || comp.series?.title || targetEvent.series?.title || '';
                const seriesSummary = summaryComp?.series?.summary || comp.series?.summary || targetEvent.series?.summary;
                const seriesCompetitors = summaryComp?.series?.competitors || comp.series?.competitors || targetEvent.series?.competitors;
                
                let playoffText = 'Playoffs';
                const gameNote = targetEvent.notes?.[0]?.headline || '';

                if (seriesTitle && gameNote && !seriesTitle.includes(gameNote) && !gameNote.includes(seriesTitle)) {
                    playoffText = `${seriesTitle} - ${gameNote}`;
                } else if (gameNote) {
                    playoffText = gameNote;
                } else if (seriesTitle) {
                    playoffText = seriesTitle;
                }

                dateText = `${dateText} • ${playoffText}`;

                // --- NEW BULLETPROOF METHOD: MANUAL SERIES CALCULATION ---
                // ESPN's API is wildly inconsistent with where it stores playoff records.
                // Instead of hunting for missing strings, we will calculate the series score manually 
                // by counting the actual completed playoff games between these two teams from the schedule!
                let manualAwayWins = 0;
                let manualHomeWins = 0;
                const aId = String(sourceAway.team?.id || away.team?.id || sourceAway.id || away.id || '');
                const hId = String(sourceHome.team?.id || home.team?.id || sourceHome.id || home.id || '');

                events.forEach(ev => {
                    const evSeason = String(ev.season?.type || ev.seasonType?.type || ev.competitions?.[0]?.season?.type || '2');
                    const isPost = ev.competitions?.[0]?.status?.type?.state === 'post' || ev.status?.type?.state === 'post';
                    const isMLBPlayoff = league === 'mlb' && ev.notes?.[0]?.headline?.toLowerCase().includes('playoff');

                    if ((evSeason === '3' || isMLBPlayoff) && isPost) {
                        const comps = ev.competitions?.[0]?.competitors;
                        if (!comps || comps.length < 2) return;

                        const c1 = comps[0];
                        const c2 = comps[1];
                        const c1Id = String(c1.id || c1.team?.id || '');
                        const c2Id = String(c2.id || c2.team?.id || '');

                        if ((c1Id === aId && c2Id === hId) || (c1Id === hId && c2Id === aId)) {
                            const aComp = c1Id === aId ? c1 : c2;
                            const hComp = c1Id === hId ? c1 : c2;
                            
                            if (aComp.winner) manualAwayWins++;
                            if (hComp.winner) manualHomeWins++;
                        }
                    }
                });

                let finalAwayText = `Series: ${manualAwayWins}-${manualHomeWins}`;
                let finalHomeText = `Series: ${manualHomeWins}-${manualAwayWins}`;

                // If ESPN does provide a clean human-readable summary (e.g. "NYK leads 2-1"), we can use it.
                if (seriesSummary && (seriesSummary.includes('lead') || seriesSummary.includes('won') || seriesSummary.includes('Tied') || seriesSummary.includes('wins'))) {
                    finalAwayText = seriesSummary;
                    finalHomeText = seriesSummary;
                }

                awayRecord = finalAwayText;
                homeRecord = finalHomeText;
            }

            let nextGameText = "No games scheduled";
            let nextOpponent = "Season Over";

            if (upcomingGames.length > 0) {
                const nextEv = upcomingGames[0];
                const nextComp = nextEv.competitions?.[0];
                
                if (nextComp && nextComp.competitors) {
                    const nextOpp = nextComp.competitors.find(c => {
                        const isMe = String(c.team?.id || c.id) === String(espnTeamId) || 
                                     (c.team?.abbreviation && String(c.team?.abbreviation).toUpperCase() === String(abbr).toUpperCase());
                        return !isMe;
                    });
                    if (nextOpp) {
                        const isHome = nextOpp.homeAway === 'away';
                        nextOpponent = `${isHome ? 'vs' : '@'} ${nextOpp.team?.shortDisplayName || nextOpp.team?.name || 'TBA'}`;
                    } else {
                        nextOpponent = "Opponent TBD";
                    }
                }
                if (nextEv.status?.type?.name === 'STATUS_TBD' || nextEv.status?.type?.name === 'STATUS_UNCONTESTED') {
                    nextGameText = "Time & Date TBD";
                } else {
                    const nextDate = new Date(nextEv.date);
                    if (nextDate.getTime() < Date.now()) {
                        nextGameText = "Awaiting Updates";
                    } else {
                        const isToday = nextDate.toDateString() === new Date().toDateString();
                        const dateFmt = isToday ? "Today" : nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                        const timeFmt = nextDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                        nextGameText = `${dateFmt} at ${timeFmt}`;
                    }
                }
            } else if (mostRecentPast) {
                const lastComp = mostRecentPast.competitions?.[0];
                const myTeamLastComp = lastComp?.competitors?.find(c => c.team?.abbreviation === abbr || String(c.team?.id) === String(espnTeamId));
                const daysSinceLastGame = (Date.now() - new Date(mostRecentPast.date).getTime()) / (1000 * 60 * 60 * 24);

                if (myTeamLastComp?.winner && (isPlayoff || daysSinceLastGame < 14)) {
                    nextGameText = "Schedule TBA";
                    nextOpponent = "Awaiting Opponent";
                } else if (daysSinceLastGame < 14) {
                    nextGameText = "Schedule TBA";
                    nextOpponent = "Awaiting Schedule";
                }
            }

            let divisionStandings = null;
            if (isTablet && league.toLowerCase() === 'mlb') {
                try {
                    const stUrl = `https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings?level=3`;
                    const stRes = await fetch(stUrl, { headers: fetchHeaders });
                    if (stRes.ok) {
                        const stJson = await stRes.json();
                        
                        let foundDivision = null;
                        const findTeamDivision = (node, parentName = '') => {
                            if (foundDivision) return;
                            if (node.standings && node.standings.entries) {
                                const hasTeam = node.standings.entries.some(e => 
                                    String(e.team?.id) === String(espnTeamId) || 
                                    String(e.team?.abbreviation).toUpperCase() === abbr.toUpperCase()
                                );
                                if (hasTeam) {
                                    let divName = node.name || node.abbreviation || 'Division';
                                    if (parentName && !divName.toUpperCase().includes(parentName.toUpperCase()) && !divName.toUpperCase().includes('AL') && !divName.toUpperCase().includes('NL')) {
                                        divName = `${parentName} ${divName}`;
                                    }
                                    divName = divName.replace(/American League/i, 'AL')
                                                     .replace(/National League/i, 'NL')
                                                     .trim();

                                    foundDivision = {
                                        name: divName,
                                        entries: node.standings.entries.map(e => {
                                            const t = e.team || {};
                                            const s = e.stats || [];
                                            const wins = s.find(x => x.name === 'wins')?.displayValue || '0';
                                            const losses = s.find(x => x.name === 'losses')?.displayValue || '0';
                                            const gb = s.find(x => x.name === 'gamesBehind')?.displayValue || s.find(x => x.name === 'gamesBehind')?.value || '-';
                                            return {
                                                id: String(t.id),
                                                abbr: String(t.abbreviation).toUpperCase(),
                                                name: t.name || t.displayName || t.abbreviation,
                                                record: `${wins}-${losses}`,
                                                gb: String(gb)
                                            };
                                        })
                                    };
                                }
                            }
                            if (node.children) {
                                node.children.forEach(child => findTeamDivision(child, node.abbreviation || node.name || parentName));
                            }
                        };
                        
                        if (stJson.children) {
                            stJson.children.forEach(c => findTeamDivision(c));
                        }
                        
                        if (foundDivision) {
                            divisionStandings = foundDivision;
                        }
                    }
                } catch (e) {
                }
            }

            const awayRank = isCollegeFootball ? parseRank(sourceAway, awayTeamJson?.team) : null;
            const homeRank = isCollegeFootball ? parseRank(sourceHome, teamJson?.team) : null;

            return {
              type: 'SPORTS',
              data: {
                trackedAbbr: abbr,
                trackedId: String(espnTeamId),
                eventId: targetEvent.id,
                league: league.toUpperCase(),
                date: dateText,
                awayId: sourceAway.team?.id || away.team?.id || sourceAway.id || away.id,
                awayAbbr: awayAbbrValue,
                awayRank,
                awayScore: awayScoreValue,
                awayRecord: awayRecord,
                awayWinner,
                awayName: sourceAway.team?.name || sourceAway.team?.shortDisplayName || away.team?.name || away.team?.shortDisplayName,
                awayLogo: awayLogo,
                homeId: sourceHome.team?.id || home.team?.id || sourceHome.id || home.id,
                homeAbbr: homeAbbrValue,
                homeRank,
                homeScore: homeScoreValue,
                homeRecord: homeRecord,
                homeWinner,
                homeName: sourceHome.team?.name || sourceHome.team?.shortDisplayName || home.team?.name || home.team?.shortDisplayName,
                homeLogo: homeLogo,
                status: statusText,
                situation: situationObj,
                topPlay: topPlayText,
                teamColor: myTeamColor,
                teamBorderColor: myTeamBorderColor,
                nextGameAway: awayNextGame,
                nextGameHome: homeNextGame,
                nextGame: { date: nextGameText, opponent: nextOpponent },
                playerSectionHeader: playerSectionHeader,
                isLive: isLiveState,
                playerGlance: {
                  name: `${leaderName.toUpperCase()}`,
                  subtext: leaderSubtext,
                  stats: leaderStats,
                },
                potgRunnerUps: potgRunnerUps,
                divisionStandings: divisionStandings
              }
            };
          } catch (error) {
            return { type: 'ERROR', data: null };
          }
        };

        // --- 3. PWHL FETCH ---
        const fetchPwhlTeam = async (teamName, abbr) => {
          const pwhlTeamColor = '#002855'; 

          try {
            let allGames = pwhlCache.current.games;
            let standings = pwhlCache.current.standings;

            if (Date.now() - pwhlCache.current.lastFetch > REFRESH_INTERVAL_MS || allGames.length === 0) {
                const seasonsUrl = 'https://lscluster.hockeytech.com/feed/index.php?feed=modulekit&view=seasons&key=446521baf8c38984&client_code=pwhl';
                const seasonsRes = await fetch(seasonsUrl, { headers: fetchHeaders });
                const seasonsJson = await seasonsRes.json();
                
                let allSeasons = seasonsJson?.SiteKit?.Seasons || [];
                if (!Array.isArray(allSeasons)) allSeasons = Object.values(allSeasons || {});
                let recentSeasons = allSeasons.map(s => String(s.season_id)).filter(id => id && id !== 'undefined');
                recentSeasons.sort((a, b) => parseInt(b) - parseInt(a));
                recentSeasons = recentSeasons.slice(0, 2);
                if (recentSeasons.length === 0) recentSeasons = ['8', '7', '5', '4', '2'];

                allGames = [];
                standings = [];

                for (const sId of recentSeasons) {
                    try {
                        const pwhlUrl = `https://lscluster.hockeytech.com/feed/index.php?feed=modulekit&view=schedule&key=446521baf8c38984&client_code=pwhl&season_id=${sId}`;
                        const res = await fetch(pwhlUrl, { headers: fetchHeaders });
                        if (res.ok) {
                            const json = await res.json();
                            let scheduleData = json?.SiteKit?.Schedule;
                            if (scheduleData) {
                                if (!Array.isArray(scheduleData)) scheduleData = Object.values(scheduleData);
                                allGames = allGames.concat(scheduleData);
                            }
                        }

                    const standingsUrl = `https://lscluster.hockeytech.com/feed/index.php?feed=modulekit&view=statviewtype&stat=conference&type=standings&key=446521baf8c38984&client_code=pwhl&season_id=${sId}&fmt=json`;
                        const sRes = await fetch(standingsUrl, { headers: fetchHeaders });
                        if (sRes.ok) {
                            const sJson = await sRes.json();
                            
                            const findStandings = (obj) => {
                                if (!obj || typeof obj !== 'object') return null;
                                
                                if (Array.isArray(obj)) {
                                    const isStandings = obj.slice(0, 3).some(item => 
                                        item && typeof item === 'object' && 
                                        (item.team_id || item.team_code) && 
                                        (item.pts !== undefined || item.points !== undefined || item.w !== undefined || item.wins !== undefined)
                                    );
                                    if (isStandings) return obj;
                                }
                                for (const key in obj) {
                                    const result = findStandings(obj[key]);
                                    if (result) return result;
                                }
                                return null;
                            };

                            let sData = findStandings(sJson) || [];
                            if (!Array.isArray(sData)) sData = Object.values(sData || {});
                            
                            sData.forEach(st => {
                                const existingIdx = standings.findIndex(x => String(x.team_id) === String(st.team_id));
                                if (existingIdx === -1) {
                                    standings.push(st);
                                } else {
                                    const existingPts = parseInt(standings[existingIdx].pts || standings[existingIdx].points || '0');
                                    const newPts = parseInt(st.pts || st.points || '0');
                                    if (newPts > existingPts) standings[existingIdx] = st;
                                }
                            });
                        }
                    } catch (e) {
                    }
                }
                pwhlCache.current = { games: allGames, standings: standings, lastFetch: Date.now() };
            }

            const uniqueGamesMap = new Map();
            allGames.forEach(g => {
                if (g && g.game_id) uniqueGamesMap.set(g.game_id, g);
            });
            const games = Array.from(uniqueGamesMap.values());
            
            const getGameTimeMs = (game) => {
                const dateStr = game?.date_time_played || game?.date_played;
                if (!dateStr) return 0;
                const parts = String(dateStr).split(/[- :T]/);
                if (parts.length >= 3) {
                    const y = parseInt(parts[0], 10);
                    const m = parseInt(parts[1], 10) - 1;
                    const d = parseInt(parts[2], 10);
                    const hr = parts[3] ? parseInt(parts[3], 10) : 19;
                    const min = parts[4] ? parseInt(parts[4], 10) : 0;
                    return new Date(y, m, d, hr, min).getTime();
                }
                return 0;
            };

            games.sort((a, b) => getGameTimeMs(a) - getGameTimeMs(b));

            const myCityMap = {
                'BOS': 'BOSTON', 'MIN': 'MINNESOTA', 'MTL': 'MONTREAL', 
                'NY': 'NEW YORK', 'OTT': 'OTTAWA', 'TOR': 'TORONTO', 
                'SEA': 'SEATTLE', 'VAN': 'VANCOUVER'
            };
            const myCity = myCityMap[abbr.toUpperCase()] || String(teamName).toUpperCase().split(' ')[0];

            const myGames = games.filter(g => {
                const hName = String(g.home_team_name || '').toUpperCase();
                const vName = String(g.visiting_team_name || '').toUpperCase();
                const hCode = String(g.home_team_code || '').toUpperCase();
                const vCode = String(g.visiting_team_code || '').toUpperCase();
                const searchAbbr = String(abbr).toUpperCase();
                const searchName = String(teamName).toUpperCase();
                
                return hCode === searchAbbr || vCode === searchAbbr ||
                       hName.includes(myCity) || vName.includes(myCity) ||
                       hName.includes(searchName) || vName.includes(searchName) ||
                       hName.includes('PWHL ' + myCity) || vName.includes('PWHL ' + myCity);
            });

            if (myGames.length === 0) return { type: 'ERROR' };
            
            const nowMs = Date.now();

            const isPastGame = (g) => {
                if (String(g.played) === '1') return true;
                const statStr = String(g.status || '');
                if (['3', '4', '5'].includes(statStr)) return true;
                const statusTextLower = String(g.game_status || '').toLowerCase();
                if (statusTextLower.includes('final') || statusTextLower.includes('f/')) return true;
                
                const gameTime = getGameTimeMs(g);
                if (gameTime > 0 && nowMs - gameTime > GAME_OVER_ESTIMATE_MS) return true;
                
                return false;
            };

            const isLiveGame = (g) => {
                if (isPastGame(g)) return false;
                const statStr = String(g.status || '');
                if (statStr === '2') return true;
                const statusTextLower = String(g.game_status || '').toLowerCase();
                if (statusTextLower.includes('progress') || statusTextLower.includes('live')) return true;
                
                const gameTime = getGameTimeMs(g);
                if (gameTime > 0 && nowMs >= gameTime && nowMs - gameTime <= GAME_OVER_ESTIMATE_MS) return true;
                
                return false;
            };

            let pastGames = myGames.filter(isPastGame);
            let liveGame = myGames.find(isLiveGame);
            let upcomingGames = myGames.filter(g => !isPastGame(g) && !isLiveGame(g));
            
            let nextUpcoming = upcomingGames[0];
            let mostRecentPast = pastGames[pastGames.length - 1]; // since sorted ascending
            
            let targetGame;
            if (liveGame) {
              targetGame = liveGame;
            } else {
              targetGame = mostRecentPast || nextUpcoming || myGames[0];
            }

            if (!targetGame) return { type: 'ERROR' };

            // --- PWHL LIVE & POTG ENHANCEMENT ---
            let homeScore = targetGame.home_goal_count || "0";
            let awayScore = targetGame.visiting_goal_count || "0";
            let isTargetLive = isLiveGame(targetGame);
            let isTargetPast = isPastGame(targetGame);
            let awayWinner = false;
            let homeWinner = false;
            let leaderName = (isTargetLive || isTargetPast) ? 'GAME MVP' : 'UPCOMING MATCHUP';
            let leaderSubtext = (isTargetLive || isTargetPast) ? 'Boxscore available at thepwhl.com' : 'Game Preview';
            let leaderStats = (isTargetLive || isTargetPast) ? 'G: --  |  A: --  |  PTS: --' : 'Awaiting Puck Drop';
            let topPlayText = 'Data officially synced from thepwhl.com.';
            let potgRunnerUps = [];

            let statusText = 'Final';
            if (targetGame.game_status) {
                statusText = targetGame.game_status;
            } else if (isTargetLive) {
                statusText = 'Live';
            } else if (isTargetPast) {
                statusText = 'Final';
            } else {
                statusText = 'Scheduled';
            }

            try {
              const summaryUrl = `https://lscluster.hockeytech.com/feed/index.php?feed=gc&key=446521baf8c38984&client_code=pwhl&game_id=${targetGame.game_id}&lang_code=en&fmt=json&tab=gamesummary&_=${Date.now()}`;
              const summaryRes = await fetch(summaryUrl, { headers: fetchHeaders });
              if (summaryRes.ok) {
                const summaryJson = await summaryRes.json();

                const gcData = summaryJson?.GC?.Gamesummary || summaryJson?.GC?.Boxscore;
                if (gcData) {
                  const metaStatus = String(gcData.meta?.status || '');
                  if (metaStatus === '2') {
                      isTargetLive = true;
                      isTargetPast = false;
                      if (leaderName === 'UPCOMING MATCHUP') {
                          leaderName = 'GAME MVP';
                          leaderSubtext = 'Boxscore available at thepwhl.com';
                          leaderStats = 'G: --  |  A: --  |  PTS: --';
                      }
                  } else if (metaStatus === '3' || metaStatus === '4') {
                      isTargetLive = false;
                      isTargetPast = true;
                      if (leaderName === 'UPCOMING MATCHUP') {
                          leaderName = 'GAME MVP';
                          leaderSubtext = 'Boxscore available at thepwhl.com';
                          leaderStats = 'G: --  |  A: --  |  PTS: --';
                      }
                  }

                  homeScore = gcData.meta?.home_goal_count || homeScore;
                  awayScore = gcData.meta?.visiting_goal_count || awayScore;

                  const params = summaryJson?.GC?.Parameters;
                  const liveClock = params?.clock || params?.time_remaining || gcData.meta?.clock;
                  const livePeriod = params?.period || gcData.meta?.period;

                  if (isTargetLive && liveClock && livePeriod) {
                      const periodMap = { '1': '1st', '2': '2nd', '3': '3rd', '4': 'OT', '5': 'SO' };
                      const period = periodMap[String(livePeriod)] || `${livePeriod}`;
                      statusText = `${liveClock} ${period}`;
                  }

                  const getArray = (obj) => {
                      if (!obj) return [];
                      if (Array.isArray(obj)) return obj;
                      return Object.values(obj);
                  };
                  
                  const goals = getArray(gcData.goals);
                  if (goals.length > 0) {
                    const lastGoal = goals[goals.length - 1];
                    const scorer = lastGoal.goal_scorer || {};
                    const name = scorer.name || `${scorer.first_name || ''} ${scorer.last_name || ''}`.trim() || 'Player';
                    const team = lastGoal.team_code || lastGoal.team?.team_code || '';
                    const time = lastGoal.time || '';
                    const period = lastGoal.period_id || lastGoal.period?.short_name || '';
                    topPlayText = `Last Goal: ${name} ${team ? '('+team+') ' : ''}at ${time} in the ${period}`;
                  }

                  const stars = getArray(gcData.threeStars || gcData.three_stars);
                  if (stars.length > 0) {
                    const firstStar = stars.find(s => String(s.star) === '1') || stars[0];
                    if (firstStar) {
                      const playerId = String(firstStar.player_id || firstStar.id || '');
                      const starName = firstStar.name || `${firstStar.first_name || ''} ${firstStar.last_name || ''}`.trim();
                      
                      const skaters = [
                          ...getArray(gcData.home_team_lineup?.players),
                          ...getArray(gcData.visitor_team_lineup?.players),
                          ...getArray(gcData.home_team_lineup?.skaters),
                          ...getArray(gcData.visitor_team_lineup?.skaters)
                      ];
                      const goalies = [
                          ...getArray(gcData.home_team_lineup?.goalies),
                          ...getArray(gcData.visitor_team_lineup?.goalies)
                      ];

                      const starSkater = skaters.find(p => String(p.player_id) === playerId || String(p.id) === playerId);
                      const starGoalie = goalies.find(p => String(p.player_id) === playerId || String(p.id) === playerId);

                      if (starSkater) {
                        leaderName = `${starSkater.first_name || ''} ${starSkater.last_name || ''}`.trim() || starName;
                        leaderSubtext = "1st Star of the Game";
                        const g = parseInt(starSkater.goals || '0', 10);
                        const a = parseInt(starSkater.assists || '0', 10);
                        const pts = parseInt(starSkater.points || '0', 10) || (g + a);
                        leaderStats = `G: ${g}  |  A: ${a}  |  PTS: ${pts}`;
                      } else if (starGoalie) {
                        leaderName = `${starGoalie.first_name || ''} ${starGoalie.last_name || ''}`.trim() || starName;
                        leaderSubtext = "1st Star of the Game";
                        const saves = parseInt(starGoalie.saves || '0', 10);
                        const sa = parseInt(starGoalie.shots_against || '0', 10);
                        const svPct = sa > 0 ? (saves / sa).toFixed(3).replace(/^0+/, '') : '.000';
                        leaderStats = `SV: ${saves}  |  SA: ${sa}  |  SV%: ${svPct}`;
                      } else if (starName) {
                        leaderName = starName;
                        leaderSubtext = "1st Star of the Game";
                        leaderStats = "Game details available on thepwhl.com";
                      }
                    }
                    if (stars.length > 1) {
                        potgRunnerUps = stars.slice(1, 4).map((star, idx) => {
                            const starName = star.name || `${star.first_name || ''} ${star.last_name || ''}`.trim() || 'Player';
                            return {
                                name: starName,
                                teamAbbr: '',
                                stats: 'Standout Performer',
                                mvpScore: `${idx + 2}nd Star`
                            };
                        });
                    }
                  }

                  if (leaderName === 'GAME MVP' || leaderName === 'UPCOMING MATCHUP') {
                      let allPwhlCandidates = [];
                      const allSkaters = [
                          ...getArray(gcData.home_team_lineup?.players),
                          ...getArray(gcData.visitor_team_lineup?.players),
                          ...getArray(gcData.home_team_lineup?.skaters),
                          ...getArray(gcData.visitor_team_lineup?.skaters)
                      ];
                      allSkaters.forEach(p => {
                          const g = parseInt(p.goals || '0', 10);
                          const a = parseInt(p.assists || '0', 10);
                          const pts = parseInt(p.points || '0', 10) || (g + a);
                          const score = (g * 2) + a;
                          if (score > 0) {
                              const skaterName = p.name || p.player_name || `${p.first_name || ''} ${p.last_name || ''}`;
                              allPwhlCandidates.push({
                                  name: skaterName.trim() || "Player",
                                  stats: `G: ${g}  |  A: ${a}  |  PTS: ${pts}`,
                                  score
                              });
                          }
                      });
                      
                      allPwhlCandidates.sort((a, b) => b.score - a.score);
                      
                      if (allPwhlCandidates.length > 0) {
                          const topSkater = allPwhlCandidates[0];
                          leaderName = topSkater.name;
                          leaderSubtext = "Top Skater";
                          leaderStats = topSkater.stats;
                          
                          potgRunnerUps = allPwhlCandidates.slice(1, 4).map(c => ({
                              name: c.name,
                              teamAbbr: '',
                              stats: c.stats,
                              mvpScore: c.score
                          }));
                      }
                  }
                  
                  if (isTargetPast && !isTargetLive) {
                      statusText = 'Final';
                  }
                }
              }
              
              if (isTargetLive) {
                  try {
                      const clockUrl = `https://lscluster.hockeytech.com/feed/index.php?feed=gc&key=446521baf8c38984&client_code=pwhl&game_id=${targetGame.game_id}&lang_code=en&fmt=json&tab=clock&_=${Date.now()}`;
                      const clockRes = await fetch(clockUrl, { headers: fetchHeaders });
                      if (clockRes.ok) {
                          const clockJson = await clockRes.json();
                          const cData = clockJson?.GC?.clock;
                          if (cData && cData.clock && cData.period) {
                              const periodMap = { '1': '1st', '2': '2nd', '3': '3rd', '4': 'OT', '5': 'SO' };
                              const period = periodMap[String(cData.period)] || `${cData.period}`;
                              statusText = `${cData.clock} ${period}`;
                          }
                      }
                  } catch (e) {}
              }
            } catch (summaryError) {
            }

            if (isTargetPast && !isTargetLive) {
                const hScore = parseInt(homeScore, 10);
                const aScore = parseInt(awayScore, 10);
                if (hScore > aScore) homeWinner = true;
                if (aScore > hScore) awayWinner = true;
            }

            let dateText = "Recent";
            if (targetGame) {
               try {
                 const ms = getGameTimeMs(targetGame);
                 if (ms > 0) {
                     const gameDate = new Date(ms);
                     dateText = gameDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                 }
               } catch(e) {}
            }

            const getPwhlNextGame = (tCode, tNameFallback) => {
                const teamGames = games.filter(g => {
                    const hCode = String(g.home_team_code || '').toUpperCase();
                    const vCode = String(g.visiting_team_code || '').toUpperCase();
                    const hName = String(g.home_team_name || '').toUpperCase();
                    const vName = String(g.visiting_team_name || '').toUpperCase();
                    const sCode = String(tCode || '').toUpperCase();
                    const sName = String(tNameFallback || '').toUpperCase();
                    
                    if (sCode && (hCode === sCode || vCode === sCode)) return true;
                    if (sName && (hName === sName || vName === sName)) return true;
                    return false;
                });
                const upcoming = teamGames.find(g => !isPastGame(g) && !isLiveGame(g));
                if (upcoming) {
                    try {
                        const ms = getGameTimeMs(upcoming);
                        if (ms > 0) {
                            const nextDate = new Date(ms);
                            const isToday = nextDate.toDateString() === new Date().toDateString();
                            const dateFmt = isToday ? "Today" : nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                            const timeFmt = nextDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                            return `${dateFmt} at ${timeFmt}`;
                        }
                    } catch(e) {}
                }
                return "Schedule TBA";
            };

            const nextGameAway = getPwhlNextGame(targetGame.visiting_team_code, targetGame.visiting_team_name);
            const nextGameHome = getPwhlNextGame(targetGame.home_team_code, targetGame.home_team_name);

            const upcomingGame = myGames.find(g => !isPastGame(g) && !isLiveGame(g));
            let nextGameText = "No games scheduled";
            let nextOpponent = "Season Over";
            if (upcomingGame) {
                try {
                    const hCode = String(upcomingGame.home_team_code || '').toUpperCase();
                    const hName = String(upcomingGame.home_team_name || '').toUpperCase();
                    const isNextHome = hCode === String(abbr).toUpperCase() || hName.includes(myCity) || hName.includes(String(teamName).toUpperCase());
                    nextOpponent = `${isNextHome ? 'vs' : '@'} ${isNextHome ? upcomingGame.visiting_team_name : upcomingGame.home_team_name}`;

                    if (upcomingGame.time_played && upcomingGame.time_played.toUpperCase() !== 'TBA') {
                        const ms = getGameTimeMs(upcomingGame);
                        const nextDate = new Date(ms);
                        const timeFmt = nextDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                        nextGameText = `${nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${timeFmt}`;
                    } else {
                        nextGameText = "Time & Date TBD";
                    }
                } catch(e) {}
            } else if (mostRecentPast) {
                const hCode = String(mostRecentPast.home_team_code || '').toUpperCase();
                const hName = String(mostRecentPast.home_team_name || '').toUpperCase();
                const isLastHome = hCode === String(abbr).toUpperCase() || hName.includes(myCity) || hName.includes(String(teamName).toUpperCase());
                const homeWon = parseInt(mostRecentPast.home_goal_count || '0') > parseInt(mostRecentPast.visiting_goal_count || '0');
                const myTeamWon = isLastHome ? homeWon : !homeWon;
                const daysSinceLastGame = (Date.now() - getGameTimeMs(mostRecentPast)) / (1000 * 60 * 60 * 24);
                
                if (myTeamWon && daysSinceLastGame < 30) {
                    nextGameText = "Schedule TBA";
                    nextOpponent = "Awaiting Opponent";
                } else if (daysSinceLastGame < 14) {
                    nextGameText = "Schedule TBA";
                    nextOpponent = "Awaiting Schedule";
                }
            }

            const getPwhlRecord = (teamId, tName) => {
                const s = standings.find(x => String(x.team_id) === String(teamId) || (x.name && tName.includes(x.name)) || (x.city && tName.includes(x.city)));
                if (s) {
                const rw = parseInt(s.wins || s.w || '0') - parseInt(s.non_reg_wins || s.nrw || '0');
                const otw = parseInt(s.ot_wins || s.otw || '0') + parseInt(s.shootout_wins || s.sow || '0');
                    const otl = parseInt(s.ot_losses || s.otl || '0') + parseInt(s.shootout_losses || s.sol || '0');
                const rl = parseInt(s.losses || s.l || '0');
                    const pts = s.points || s.pts || '0';
                const recordStr = `${rw}-${otw}-${otl}-${rl} (${pts} pts)`;
                    return recordStr;
                }
                return '';
            };

        const getFallbackRecord = (rw, otw, otl, rl) => {
            if (rw === undefined || rl === undefined) return '';
            const w = parseInt(rw || '0', 10);
            const ow = parseInt(otw || '0', 10);
            const ol = parseInt(otl || '0', 10);
            const l = parseInt(rl || '0', 10);
            const p = (w * 3) + (ow * 2) + (ol * 1);
            return `${w}-${ow}-${ol}-${l} ((${p}))`;
        };

            return {
              type: 'SPORTS',
              data: {
                trackedAbbr: abbr,
                trackedId: String(abbr),
                eventId: targetGame.game_id,
                league: 'PWHL',
                date: dateText,
                awayId: targetGame.visiting_team || targetGame.visiting_team_code,
                awayAbbr: targetGame.visiting_team_code,
                awayScore: awayScore,
            awayRecord: getPwhlRecord(targetGame.visiting_team, targetGame.visiting_team_name) || getFallbackRecord(targetGame.visiting_wins, targetGame.visiting_ot_wins, targetGame.visiting_ot_losses, targetGame.visiting_losses),
                awayWinner,
                awayName: targetGame.visiting_team_name,
                awayLogo: `https://assets.leaguestat.com/pwhl/logos/50x50/${targetGame.visiting_team}.png`,
                homeId: targetGame.home_team || targetGame.home_team_code,
                homeAbbr: targetGame.home_team_code,
                homeScore: homeScore,
            homeRecord: getPwhlRecord(targetGame.home_team, targetGame.home_team_name) || getFallbackRecord(targetGame.home_wins, targetGame.home_ot_wins, targetGame.home_ot_losses, targetGame.home_losses),
                homeWinner,
                homeName: targetGame.home_team_name,
                homeLogo: `https://assets.leaguestat.com/pwhl/logos/50x50/${targetGame.home_team}.png`,
                status: statusText,
                isLive: isTargetLive,
                situation: null,
                topPlay: topPlayText,
                teamColor: pwhlTeamColor,
                nextGameAway,
                nextGameHome,
                nextGame: { date: nextGameText, opponent: nextOpponent },
                playerGlance: { name: leaderName, subtext: leaderSubtext, stats: leaderStats },
                potgRunnerUps
              }
            };
          } catch (error) {
            return { type: 'ERROR' };
          }
        };

        const selectedNews = preferences.teams.filter(p => p.league === 'news');
        const customFeeds = preferences.teams.filter(p => p.league === 'freetext' || (p.id && p.id.startsWith('news-custom-')));
        const selectedTeams = preferences.teams.filter(p => p.league !== 'news' && p.league !== 'special' && p.league !== 'scoreboard' && p.league !== 'weather' && p.league !== 'freetext' && !(p.id && p.id.startsWith('news-custom-')));
        const selectedScoreboards = preferences.teams.filter(p => p.league === 'scoreboard');
        const weatherPref = preferences.teams.find(p => p.league === 'weather');
        const freeTextPref = preferences.teams.find(p => p.league === 'freetext');
        const draftPref = preferences.teams.find(p => p.id === 'special-nfl-draft');

        const totalTasks = selectedNews.length + customFeeds.length + selectedTeams.length + selectedScoreboards.length + (weatherPref ? 1 : 0) + (draftPref ? 1 : 0);
        let completedTasks = 0;
        const tickProgress = () => {
            completedTasks++;
            if (loading && totalTasks > 0) {
                setLoadingProgress(Math.min(1, completedTasks / totalTasks));
            }
        };

        const newsPromises = selectedNews.map(n => fetchRssFeed(n.url, n.name).then(res => { tickProgress(); return res; }));
        const customFeedPromises = customFeeds.map(feed => fetchRssFeed(feed.url, feed.name).then(res => { tickProgress(); return { feed, items: res }; }));

        const [fetchedNewsArrays, fetchedCustomFeeds] = await Promise.all([
            Promise.all(newsPromises),
            Promise.all(customFeedPromises)
        ]);
        
        let allNews = fetchedNewsArrays.flat();
        if (allNews.length === 0 && selectedNews.length > 0) {
            allNews = [{ title: "News Feeds Offline", source: "System", date: "Today" }];
        }

        const teamPromises = selectedTeams.map(pref => {
            if (pref.league === 'pwhl') return fetchPwhlTeam(pref.name, pref.abbr).then(res => { tickProgress(); return res; });
            return fetchEspnTeam(pref.sport, pref.league, pref.abbr, pref.name).then(res => { tickProgress(); return res; });
        });
        const fetchedTeams = await Promise.all(teamPromises);

        const scoreboardPromises = selectedScoreboards.map(pref => fetchScoreboard(pref.sport, pref.targetLeague, pref.id).then(res => { tickProgress(); return res; }));
        const fetchedScoreboardsArrays = await Promise.all(scoreboardPromises);
        const allScoreboardCards = fetchedScoreboardsArrays.flat();

        let weatherCard = null;
        if (weatherPref) {
            const weatherInfo = await buildWeatherCard();
            tickProgress();
            weatherCard = {
              type: 'WEATHER',
              data: weatherInfo || {
                city: 'Local Weather',
                temperature: '--',
                feelsLike: '--',
                condition: 'Unavailable',
                icon: '❓',
                backgroundColor: ['#4A76E1', '#4A76E1'],
                high: '--',
                low: '--',
                precip: '--',
                forecast: [],
                code: 0,
                isDay: 1
              }
            };
        }

        const sportsCards = [];
        fetchedTeams.forEach(item => {
            if (item && item.type !== 'ERROR' && item.data) {
                let merged = false;
                for (let existing of sportsCards) {
                    if (isSameGame(existing.data, item.data)) {
                        existing.data.bothTracked = true;
                        merged = true;
                        break;
                    }
                }
                if (!merged) {
                    sportsCards.push(item);
                }
            }
        });
        
        // GROUP ALGORITHM: Hard-coded category order
        let grouped = [];
        
        // 1. Weather
        if (weatherCard) {
            grouped.push(weatherCard);
        }

        // 2. News
        if (selectedNews.length > 0 && fetchedNewsArrays.flat().length === 0) {
            grouped.push({ type: 'NEWS', data: { title: "News Feeds Offline", source: "System", date: "Today" } });
        } else {
            selectedNews.forEach(pref => {
                const newsIdx = selectedNews.findIndex(n => n.id === pref.id);
                if (newsIdx > -1 && fetchedNewsArrays[newsIdx]) {
                    fetchedNewsArrays[newsIdx]
                        .filter(item => isValidHeadline(item.title))
                        .slice(0, 2)
                        .forEach(newsItem => grouped.push({ type: 'NEWS', data: newsItem }));
                }
            });
        }

        // 2.5. Custom Feeds (FREETEXT)
        fetchedCustomFeeds.forEach(({ feed, items }) => {
            if (items && items.length > 0) {
                const cards = splitRssItemIntoCards(items[0], isTablet);
                cards.forEach(cardChunk => {
                    grouped.push({
                        type: 'FREETEXT',
                        data: {
                            title: cardChunk.title,
                            body: cardChunk.body,
                            source: feed.name,
                            date: cardChunk.date,
                            url: feed.url,
                            pageNumber: cardChunk.pageNumber,
                            pageTotal: cardChunk.pageTotal,
                        }
                    });
                });
            } else {
                grouped.push({
                    type: 'FREETEXT',
                    data: {
                        title: `Could not load feed: ${feed.name}`,
                        body: '',
                        source: feed.name,
                        date: 'Now',
                        url: feed.url,
                        pageNumber: 1,
                        pageTotal: 1,
                    }
                });
            }
        });

        // 2.7. Essential Cards (Clock, Zmanim, Parsha)
        const hasClockCard = preferences.teams.some(p => p.id === 'card-clock');
        if (hasClockCard) {
            grouped.push({
                type: 'CLOCK',
                data: {
                    locationName: locationName || 'Local',
                    sunsetTime: sunsetTime,
                    hebrewDate: hebrewDate
                }
            });
        }

        const hasZmanimCard = preferences.teams.some(p => p.id === 'card-zmanim');
        if (hasZmanimCard) {
            let candleTime = null;
            let havdalahTime = null;
            let havdalah72Time = null;

            upcomingZmanim.forEach(z => {
                if (!candleTime && (z.label.includes('CANDLE') || z.label.includes('LIGHTING'))) candleTime = z.time;
                if (!havdalahTime && z.label.includes('HAVDALAH')) havdalahTime = z.time;
            });

            if (sunsetTime) {
                const d72 = new Date(sunsetTime.getTime() + 72 * 60 * 1000);
                havdalah72Time = d72.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            }

            grouped.push({
                type: 'ZMANIM',
                data: {
                    locationName: locationName || 'Local',
                    candleLighting: candleTime,
                    havdallah: havdalahTime,
                    havdallah72: havdalah72Time,
                    zmanimList: fullZmanimTable.length > 0 ? fullZmanimTable : upcomingZmanim,
                    hebrewDate: hebrewDate
                }
            });
        }

        const hasParshaCard = preferences.teams.some(p => p.id === 'card-parsha');
        if (hasParshaCard) {
            let candleTime = null;
            upcomingZmanim.forEach(z => {
                if (!candleTime && (z.label.includes('CANDLE') || z.label.includes('LIGHTING'))) candleTime = z.time;
            });
            if (!candleTime) candleTime = parshaInfo?.candleLighting || null;

            grouped.push({
                type: 'PARSHA',
                data: {
                    parshaName: parshaInfo?.parshaName || 'Weekly Parsha',
                    parshaHebrew: parshaInfo?.parshaHebrew || 'פרשת השבוע',
                    haftarah: parshaInfo?.haftarah || null,
                    candleLighting: candleTime,
                    date: parshaInfo?.date ? `SHABBAT • ${new Date(parshaInfo.date + (parshaInfo.date.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()}` : 'SHABBAT'
                }
            });
        }

        // Standings Data Fetching for Division Standings Cards
        const selectedStandings = preferences.teams.filter(p => p.league === 'standings');
        const standingsCards = [];

        if (selectedStandings.length > 0) {
            const uniqueLeagues = [...new Set(selectedStandings.map(s => s.targetLeague || s.league))];

            for (const tLeague of uniqueLeagues) {
                if (tLeague === 'pwhl') {
                    const pwhlStandings = pwhlCache.current.standings || [];
                    const pwhlEntries = pwhlStandings.map((team, idx) => ({
                        rank: idx + 1,
                        id: String(team.team_id || idx),
                        abbr: team.code || team.name?.slice(0, 3)?.toUpperCase() || 'PWHL',
                        name: team.name || team.city || 'PWHL Team',
                        logo: team.logo_url || 'https://cdn.harianbasis.co/media/images/2026/05/HeWKBAB5QG.jpeg?location=1&width=&height=&quality=90&fit=1',
                        record: `${team.wins || 0}-${team.losses || 0}`,
                        wins: String(team.wins || 0),
                        losses: String(team.losses || 0),
                        points: String(team.points || team.pts || 0),
                        winPct: null,
                        gb: '-',
                        streak: team.streak || null
                    }));

                    standingsCards.push({
                        type: 'STANDINGS',
                        data: {
                            league: 'PWHL',
                            targetLeague: 'pwhl',
                            divisionName: 'PWHL League',
                            entries: pwhlEntries,
                            logo: 'https://cdn.harianbasis.co/media/images/2026/05/HeWKBAB5QG.jpeg?location=1&width=&height=&quality=90&fit=1',
                            headerText: 'PWHL LEAGUE STANDINGS',
                            prefId: 'standings-pwhl-all'
                        }
                    });
                } else {
                    const sportMap = {
                        'mlb': 'baseball',
                        'nfl': 'football',
                        'college-football': 'football',
                        'nba': 'basketball',
                        'wnba': 'basketball',
                        'nhl': 'hockey',
                        'usa.1': 'soccer',
                        'eng.1': 'soccer'
                    };
                    const sport = sportMap[tLeague] || 'baseball';
                    const stUrl = `https://site.api.espn.com/apis/v2/sports/${sport}/${tLeague}/standings?level=3`;
                    try {
                        const stRes = await fetch(stUrl, { headers: fetchHeaders });
                        if (stRes.ok) {
                            const stJson = await stRes.json();
                            const parsedDivs = parseEspnStandings(stJson, sport, tLeague);

                            let leagueLogo = `https://a.espncdn.com/i/teamlogos/leagues/500/${tLeague}.png`;
                            if (tLeague === 'eng.1') leagueLogo = 'https://www.thesun.co.uk/wp-content/uploads/2022/01/logo-2-1.png';
                            if (tLeague === 'usa.1') leagueLogo = 'https://cdn.freebiesupply.com/images/large/2x/mls-logo-png-transparent.png';

                            const itemsForLeague = selectedStandings.filter(s => (s.targetLeague || s.league) === tLeague);
                            itemsForLeague.forEach(sItem => {
                                const targetDivNorm = normalizeDivisionName(sItem.divisionName || sItem.name);
                                const matchedDiv = parsedDivs.find(d => {
                                    const dNorm = normalizeDivisionName(d.divisionName);
                                    return dNorm.toLowerCase().includes(targetDivNorm.toLowerCase()) || 
                                           targetDivNorm.toLowerCase().includes(dNorm.toLowerCase()) ||
                                           (d.rawName && sItem.divisionName && d.rawName.toLowerCase().includes(sItem.divisionName.toLowerCase()));
                                }) || parsedDivs[0];

                                if (matchedDiv) {
                                    standingsCards.push({
                                        type: 'STANDINGS',
                                        data: {
                                            league: tLeague,
                                            targetLeague: tLeague,
                                            divisionName: sItem.divisionName || matchedDiv.divisionName,
                                            entries: matchedDiv.entries,
                                            logo: leagueLogo,
                                            headerText: `${formatLeagueName(tLeague)} • ${(sItem.divisionName || matchedDiv.divisionName).toUpperCase()} STANDINGS`,
                                            prefId: sItem.id
                                        }
                                    });
                                }
                            });
                        }
                    } catch (err) {
                        console.warn('[TickerApp] fetchStandings error for', tLeague, err);
                    }
                }
            }
        }

        // League Grouping Helper: Scoreboard -> Teams -> Standings
        const pushLeagueGroup = (scoreboardId, sportFilter, leagueFilter) => {
            // 1. Push Scoreboard if selected
            if (scoreboardId) {
                const sbPref = selectedScoreboards.find(p => p.id === scoreboardId);
                if (sbPref) {
                    const sbCards = allScoreboardCards.filter(sb => sb.data.prefId === sbPref.id);
                    sbCards.forEach(sb => grouped.push(sb));
                }
            }

            // 2. Push Teams for this league
            preferences.teams.filter(p => {
                if (p.league === 'scoreboard' || p.league === 'standings') return false;
                if (sportFilter && p.sport !== sportFilter) return false;
                if (leagueFilter && p.league !== leagueFilter) return false;
                return true;
            }).forEach(pref => {
                const match = sportsCards.find(sc => 
                    sc.data.league.toLowerCase() === pref.league.toLowerCase() &&
                    (sc.data.trackedAbbr === pref.abbr || 
                    (sc.data.bothTracked && (sc.data.awayAbbr === pref.abbr || sc.data.homeAbbr === pref.abbr)))
                );
                if (match && !grouped.includes(match)) {
                    grouped.push(match);
                }
            });

            // 3. Push Standings for this league
            standingsCards.filter(sc => {
                if (leagueFilter && sc.data.targetLeague && sc.data.targetLeague.toLowerCase() === leagueFilter.toLowerCase()) return true;
                if (leagueFilter === 'usa.1' && sc.data.targetLeague === 'usa.1') return true;
                if (leagueFilter === 'eng.1' && sc.data.targetLeague === 'eng.1') return true;
                if (leagueFilter === 'pwhl' && sc.data.targetLeague === 'pwhl') return true;
                return false;
            }).forEach(st => {
                if (!grouped.includes(st)) grouped.push(st);
            });
        };

        // 3. Baseball
        pushLeagueGroup('scoreboard-mlb', 'baseball', 'mlb');
        // 4. Football
        pushLeagueGroup('scoreboard-nfl', 'football', 'nfl');
        pushLeagueGroup('scoreboard-ncaaf', 'football', 'college-football');
        // 5. Hockey
        pushLeagueGroup('scoreboard-nhl', 'hockey', 'nhl');
        pushLeagueGroup(null, 'hockey', 'pwhl');
        // 6. Basketball
        pushLeagueGroup('scoreboard-nba', 'basketball', 'nba');
        pushLeagueGroup('scoreboard-wnba', 'basketball', 'wnba');
        // 7. Soccer
        pushLeagueGroup('scoreboard-mls', 'soccer', 'usa.1');
        pushLeagueGroup('scoreboard-epl', 'soccer', 'eng.1');
        pushLeagueGroup('scoreboard-fifa', 'soccer', 'fifa.world');

        // Any remaining standings cards not matched above
        standingsCards.forEach(st => {
            if (!grouped.includes(st)) grouped.push(st);
        });

        // 8. Specials
        let draftData = null;
        if (draftPref) {
            draftData = await fetchNflDraft();
            tickProgress();
            if (!draftData) draftData = { type: 'NFL_DRAFT', data: { recentPicks: [], nextPick: null, year: new Date().getFullYear() } };
            grouped.push(draftData);
        }

        setDisplayCycle(grouped);
      } catch (e) {
        console.warn('[TickerApp] fetchData error', e);
        setDisplayCycle([]);
        setLoadingError(true);
      } finally {
        setLoading(false);
      }
    }, [preferences, isTablet]);

  useEffect(() => {
    fetchData();
    const dataInterval = setInterval(() => fetchData(), REFRESH_INTERVAL_MS); 
    return () => clearInterval(dataInterval);
  }, [fetchData]);

  const displayCycleRef = useRef(displayCycle);
  useEffect(() => {
    displayCycleRef.current = displayCycle;
  }, [displayCycle]);

  // Auto-scroll the indicator bar so the active item stays centered
  useEffect(() => {
    if (indicatorScrollRef.current && isTablet && displayCycle.length > 0) {
       const itemWidth = 40; // Approx 32px icon width + 8px gap
       const activeIndex = currentIndex % displayCycle.length;
       const offset = (activeIndex * itemWidth) - (windowWidth / 2) + (itemWidth / 2);
       indicatorScrollRef.current.scrollTo({ x: Math.max(0, offset), animated: true });
    }
  }, [currentIndex, displayCycle.length, isTablet, windowWidth]);

  useEffect(() => {
    if (displayCycle.length === 0) return;

    const currentCycle = displayCycleRef.current;
    if (!currentCycle || currentCycle.length === 0) return;

    const duration = ANIMATION_DURATION_MS; // Fixed 8 seconds
    const fadeOutPoint = ANIMATION_FADE_TRIGGER_MS; // Trigger fade at 7.7 seconds
    const animationDuration = duration - fadeOutPoint; // 300ms fade animation

    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: duration,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    const timer = setTimeout(() => {
      const activeCycle = displayCycleRef.current;
      if (!activeCycle || activeCycle.length === 0) return;

      const nextIndex = (currentIndex + 1) % activeCycle.length;
      const currentItem = activeCycle[currentIndex % activeCycle.length];
      const nextItem = activeCycle[nextIndex];
      
      // Determine if we are transitioning between similar card types
      const isNewsToNews = currentItem?.type === 'NEWS' && nextItem?.type === 'NEWS';
      const isFreeTextToFreeText = currentItem?.type === 'FREETEXT' && nextItem?.type === 'FREETEXT';

      // 1. Fade out the left panel conditionally
      if (!isNewsToNews) {
        Animated.timing(fadeAnimLeft, {
          toValue: 0,
          duration: isFreeTextToFreeText ? 0 : animationDuration,
          useNativeDriver: true,
        }).start();
      }

      // 2. Always fade out the right panel
      Animated.timing(fadeAnimRight, {
        toValue: 0,
        duration: animationDuration,
        useNativeDriver: true,
      }).start(() => {
        // 3. Swap the card while it is invisible
        setCurrentIndex(nextIndex);
        
        // 4. Smoothly fade the content back in
        if (!isNewsToNews) {
          Animated.timing(fadeAnimLeft, {
            toValue: 1,
            duration: isFreeTextToFreeText ? 0 : animationDuration,
            delay: 16,
            useNativeDriver: true,
          }).start();
        }
        
        Animated.timing(fadeAnimRight, {
          toValue: 1,
          duration: animationDuration,
          delay: 16,
          useNativeDriver: true,
        }).start();
      });
    }, fadeOutPoint);
    
    return () => clearTimeout(timer);
  }, [currentIndex, displayCycle.length === 0]);

  const getSmartLogoStyle = useCallback((logoUri, bgColor = '#15234b') => {
    if (!logoUri) return {};
    try {
        const uriLower = String(logoUri).toLowerCase();
        const bg = String(bgColor).toLowerCase();
        
        let r = 0, g = 0, b = 0;
        const hex = bg.replace('#', '');
        if (hex.length === 6) {
            r = parseInt(hex.substring(0, 2), 16);
            g = parseInt(hex.substring(2, 4), 16);
            b = parseInt(hex.substring(4, 6), 16);
        }
        
        // Loosen the strictness slightly so we reliably detect all variations of red/yellow
        const isRedBg = r > 110 && g < 110 && b < 110;
        const isYellowBg = r > 140 && g > 140 && b < 100;
        const isGreenBg = g > r && g > b && r < 100;

        const isMlb = uriLower.includes('/mlb/') || uriLower.includes('baseball');
        const isNba = uriLower.includes('/nba/') || uriLower.includes('basketball');

        // 1. Athletics Smart Color Swapping
        if (uriLower.includes('/ath.png') || uriLower.includes('athletics')) {
          if (isGreenBg || bg.includes('003831')) return { tintColor: '#EFB21E' }; // Yellow
          if (isYellowBg || bg.includes('efb21e')) return { tintColor: '#003831' }; // Green
          return { tintColor: '#EFB21E' }; // Default to Yellow
        }

        // 2. Dynamic Color Teams (Rockets, Phillies, Reds, Padres)
        if ((isNba && uriLower.includes('/hou.png')) || uriLower.includes('rockets')) {
            return isRedBg ? { tintColor: '#FFFFFF' } : { tintColor: '#CE1141' };
        }
        if ((isMlb && uriLower.includes('/phi.png')) || uriLower.includes('phillies')) {
            return isRedBg ? { tintColor: '#FFFFFF' } : { tintColor: '#E81828' };
        }
        if ((isMlb && uriLower.includes('/cin.png')) || uriLower.includes('reds')) {
            return isRedBg ? { tintColor: '#FFFFFF' } : { tintColor: '#C6011F' };
        }
        if ((isMlb && uriLower.includes('/sd.png')) || uriLower.includes('padres')) {
            return isYellowBg ? { tintColor: '#FFFFFF' } : { tintColor: '#FFC425' };
        }

        // 3. White-Only Logo Overrides
        const isWhiteOnly = [
          uriLower.includes('nyy'), uriLower.includes('yankees'), 
          isMlb && uriLower.includes('/tb.png'), uriLower.includes('rays'), 
          isMlb && uriLower.includes('/kc.png'), uriLower.includes('royals'), 
          uriLower.includes('/lad.png'), uriLower.includes('dodgers'), 
          isNba && uriLower.includes('/phi.png'), uriLower.includes('76ers'),
          isMlb && uriLower.includes('/min.png'), uriLower.includes('twins')
        ].some(Boolean);

        if (isWhiteOnly) {
           return { tintColor: '#FFFFFF' };
        }
    } catch (e) {}
    return {};
  }, []);

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={styles.wrapper} edges={['top', 'left', 'right']}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </SafeAreaView>
    );
  }

  if (loading || displayCycle.length === 0) {
    const percent = Math.round(loadingProgress * 100);
    return (
      <SafeAreaView style={styles.loadingContainer} edges={['top', 'left', 'right']}>
        <Text style={[styles.loadingText, isTablet && { fontSize: 72 }]}>Shabbat Shalom U'Mevorach</Text>
        <View style={styles.loadingBarContainer}>
          <View style={[styles.loadingBarFill, { width: `${percent}%` }]} />
        </View>
        <Text style={[styles.loadingPercent, isTablet && { fontSize: 24 }]}>{percent}% Loaded</Text>
        {loadingError && (
          <Text style={{ color: '#FF6B6B', fontSize: 16, marginTop: 20, textAlign: 'center', maxWidth: 420 }}>
            Unable to load live data right now. The ticker will retry automatically.
          </Text>
        )}
        {showSetupButton && (
          <TouchableOpacity style={styles.floatingSetupButton} onPress={onSetup}>
            <Text style={styles.floatingSetupButtonText}>⚙️ Setup ({setupCountdown})</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>
    );
  }

  const currentItem = displayCycle[currentIndex % displayCycle.length];

  const zmanimLayout = preferences.zmanimLayout || 'standard';
  const showZmanimInInfoPanel = !isTablet || zmanimLayout === 'standard';
  const showZmanimInFooter = isTablet && zmanimLayout === 'always-on';

  // The logic for showing Havdalah above the clock is now deprecated by the new requirements.
  // We will set this to false and handle display in the info panel or footer.
  const shouldShowHavdalahAboveClock = false;


  if (!currentItem || !currentItem.data) {
    return (
      <SafeAreaView style={styles.wrapper} edges={['top', 'left', 'right']}>
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
  
  const infoLabelStyle = [styles.infoLabel, isTablet && { fontSize: 14, marginBottom: 6 }];
  const infoValueStyle = [styles.infoValue, isTablet && { fontSize: 28 }];
  const leagueTextStyle = [styles.leagueText, isTablet && { fontSize: 18, marginBottom: 20 }];
  const isCards = (preferences?.format || 'classic') === 'cards';
  const cardMaxWidth = isCards ? (isTablet ? 1600 : '100%') : (layoutMode === 'zoomed' ? (isTablet ? 1400 : 1100) : (isTablet ? 1200 : 900));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
    <View style={[
      styles.wrapper, 
      { flexDirection: 'column' }, 
      isTablet && !isCards && { paddingBottom: 50 }, 
      isTablet && isCards && { paddingBottom: 44 }, 
      isCards && { paddingHorizontal: isTablet ? 24 : 12, paddingVertical: isTablet ? 8 : 4 }
    ]}>
      
      {/* TOP ROW */}
      <View style={{ flexDirection: 'row', width: '100%', flex: 1 }}>
      {/* LEFT DASHBOARD PANEL (TOP) */}
      {!isCards && layoutMode !== 'zoomed' && (
      <View style={[
        styles.leftPanel, 
        isTablet && { justifyContent: 'flex-start', paddingTop: 20 }
      ]}>
        {shouldShowHavdalahAboveClock && (
          <Text style={[styles.havdalahClockText, isTablet && { fontSize: 18, marginBottom: 8 }]}>
            Havdalah: {havdalahZman.time}
          </Text>
        )}
        <View style={styles.clockContainer}>
          <Text style={[styles.timeText, isTablet && { fontSize: 72 }]} numberOfLines={1} adjustsFontSizeToFit>{timeString}</Text>
          <Text style={[styles.dateText, isTablet && { fontSize: 24, marginTop: 10 }]}>{dateString}</Text>
        </View>
        
        <View style={styles.divider} />
        
        <Animated.View style={{ opacity: fadeAnimLeft, width: '100%' }}>
          {currentItem.type === 'NEWS' || currentItem.type === 'FREETEXT' ? (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>HEBREW DATE</Text>
                <Text style={infoValueStyle}>{hebrewDate || "Loading..."}</Text>
              </View>
              {showZmanimInInfoPanel && (
                upcomingZmanim.length > 0 ? (
                  upcomingZmanim.slice(0, isTablet ? 3 : 2).map((z, idx) => (
                    <View key={idx} style={styles.infoBlock}>
                      <Text style={infoLabelStyle}>{z.label}</Text>
                      <Text style={infoValueStyle}>{z.time}</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.infoBlock}>
                    <Text style={infoLabelStyle}>UPCOMING ZMANIM</Text>
                    <Text style={infoValueStyle}>Calculating...</Text>
                  </View>
                )
              )}
            </View>
          ) : currentItem.type === 'WEATHER' ? (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>LOCAL WEATHER</Text>
                <Text style={infoValueStyle}>{currentItem.data.city}</Text>
              </View>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>NOW</Text>
                <Text style={infoValueStyle}>{`${currentItem.data.temperature} • ${currentItem.data.condition}`}</Text>
              </View>
              {isTablet && showZmanimInInfoPanel && (
                upcomingZmanim.length > 0 ? (
                  upcomingZmanim.slice(0, 3).map((z, idx) => (
                    <View key={idx} style={styles.infoBlock}>
                      <Text style={infoLabelStyle}>{z.label}</Text>
                      <Text style={infoValueStyle}>{z.time}</Text>
                    </View>
                  ))
                ) : (
                  <View style={styles.infoBlock}>
                    <Text style={infoLabelStyle}>UPCOMING ZMANIM</Text>
                    <Text style={infoValueStyle}>Calculating...</Text>
                  </View>
                )
              )}
            </View>
          ) : currentItem.data.bothTracked ? (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>NEXT: {currentItem.data.awayAbbr}</Text>
                <Text style={infoValueStyle}>{currentItem.data.nextGameAway}</Text>
              </View>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>NEXT: {currentItem.data.homeAbbr}</Text>
                <Text style={infoValueStyle}>{currentItem.data.nextGameHome}</Text>
              </View>
            </View>
          ) : currentItem.type === 'NFL_DRAFT' ? (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>ON THE CLOCK</Text>
                {currentItem.data.nextPick ? (
                  <>
                    <Text style={infoValueStyle}>{currentItem.data.nextPick.team?.name || currentItem.data.nextPick.team?.abbreviation || 'Next Team'}</Text>
                    <Text style={[infoValueStyle, { fontSize: isTablet ? 20 : 16, marginTop: 6, opacity: 0.8 }]}>
                      Round {currentItem.data.nextPick.round} • Pick {currentItem.data.nextPick.pick}
                    </Text>
                  </>
                ) : (
                  <Text style={infoValueStyle}>{currentItem.data.recentPicks?.length > 0 ? "Draft Concluded" : "Awaiting Draft"}</Text>
                )}
              </View>
            </View>
          ) : currentItem.type === 'SCOREBOARD' ? (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>DIVISION LEADERS</Text>
                {currentItem.data.divisionLeaders && currentItem.data.divisionLeaders.length > 0 ? (
                  <View style={{ marginTop: 4, gap: isSmallDevice ? 4 : isTablet ? 12 : 6 }}>
                    {currentItem.data.divisionLeaders.slice(0, 8).map((leader, idx) => (
                      <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: '#EBEBF5', fontSize: isSmallDevice ? 12 : isTablet ? 18 : 14, opacity: 0.8, width: '38%' }} numberOfLines={1}>{leader.divName}</Text>
                        <Text style={{ color: '#ffffff', fontSize: isSmallDevice ? 13 : isTablet ? 19 : 15, fontWeight: '700', width: '25%' }} numberOfLines={1}>{leader.team}</Text>
                        <Text style={{ color: '#ffffff', fontSize: isSmallDevice ? 13 : isTablet ? 19 : 15, fontWeight: '600', width: '35%', textAlign: 'right' }} numberOfLines={1}>{leader.record}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={infoValueStyle}>Standings TBA</Text>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.infoContainer}>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>{currentItem.data.trackedAbbr ? `${currentItem.data.trackedAbbr} NEXT MATCHUP` : 'NEXT MATCHUP'}</Text>
                <Text style={infoValueStyle}>{currentItem.data.nextGame?.opponent || "Opponent TBA"}</Text>
              </View>
              <View style={styles.infoBlock}>
                <Text style={infoLabelStyle}>DATE & TIME</Text>
                <Text style={infoValueStyle}>{currentItem.data.nextGame?.date || "Schedule TBA"}</Text>
              </View>

              {isTablet && currentItem.data.league === 'MLB' && currentItem.data.divisionStandings && (
                <View style={[styles.infoBlock, { marginTop: 20 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginHorizontal: -8 }}>
                    <Text style={[infoLabelStyle, { flex: 1 }]}>{currentItem.data.divisionStandings.name.toUpperCase()} STANDINGS</Text>
                    <Text style={[infoLabelStyle, { width: 60, textAlign: 'right' }]}>W-L</Text>
                    <Text style={[infoLabelStyle, { width: 45, textAlign: 'right' }]}>GB</Text>
                  </View>
                  <View style={{ gap: 6, marginTop: 4 }}>
                    {currentItem.data.divisionStandings.entries.map((team, idx) => {
                      const isTracked = team.abbr === currentItem.data.trackedAbbr || team.id === currentItem.data.trackedId;
                      return (
                        <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: isTracked ? 'rgba(255, 255, 255, 0.15)' : 'transparent', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginHorizontal: -8 }}>
                          <Text style={{ color: isTracked ? '#FFFFFF' : '#EBEBF5', fontSize: 18, fontWeight: isTracked ? '700' : '500', width: 25 }}>{idx + 1}.</Text>
                          <Text style={{ color: isTracked ? '#FFFFFF' : '#EBEBF5', fontSize: 18, fontWeight: isTracked ? '700' : '500', flex: 1 }} numberOfLines={1}>{team.name}</Text>
                          <Text style={{ color: isTracked ? '#FFFFFF' : '#EBEBF5', fontSize: 18, fontWeight: isTracked ? '700' : '500', width: 60, textAlign: 'right' }}>{team.record}</Text>
                          <Text style={{ color: isTracked ? '#FFFFFF' : '#EBEBF5', opacity: isTracked ? 0.9 : 0.6, fontSize: 16, fontWeight: '500', width: 45, textAlign: 'right' }}>{team.gb === '0' || team.gb === '0.0' ? '-' : team.gb}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}
        </Animated.View>
      </View>
      )}

      {/* RIGHT CARD PANEL (TOP) */}
      <View style={[
        styles.rightPanel, 
        (isCards || layoutMode === 'zoomed') && { flex: 1, width: '100%', height: '100%', justifyContent: 'center' }, 
        !isCards && isTablet && { justifyContent: 'flex-start'},
        !isCards && !isTablet && { flex: 1, justifyContent: 'center' }
      ]}>
        <Animated.View style={[
          { opacity: fadeAnimRight, width: '100%', alignItems: 'center' },
          (isCards || !isTablet) && { flex: 1, width: '100%', justifyContent: 'center' }
        ]}>
                              {currentItem.type === 'CLOCK' ? (
            <ClockCard
              currentTime={currentTime}
              hebrewDate={hebrewDate}
              locationName={locationName}
              sunsetTime={sunsetTime}
              isTablet={isTablet}
              isCards={isCards}
              cardMaxWidth={cardMaxWidth}
              interpolatedWidth={interpolatedWidth}
            />
          ) : currentItem.type === 'ZMANIM' ? (
            <ZmanimCard
              data={currentItem.data}
              upcomingZmanim={upcomingZmanim}
              fullZmanimTable={fullZmanimTable}
              sunsetTime={sunsetTime}
              locationName={locationName}
              isTablet={isTablet}
              isCards={isCards}
              cardMaxWidth={cardMaxWidth}
              interpolatedWidth={interpolatedWidth}
            />
          ) : currentItem.type === 'STANDINGS' ? (
            <StandingsCard
              data={currentItem.data}
              isTablet={isTablet}
              isCards={isCards}
              cardMaxWidth={cardMaxWidth}
              interpolatedWidth={interpolatedWidth}
            />
          ) : currentItem.type === 'PARSHA' ? (
            <ParshaCard
              data={currentItem.data}
              parshaInfo={parshaInfo}
              upcomingZmanim={upcomingZmanim}
              isTablet={isTablet}
              isCards={isCards}
              cardMaxWidth={cardMaxWidth}
              interpolatedWidth={interpolatedWidth}
            />
          ) : currentItem.type === 'NEWS' ? (
            <View style={[
              styles.card, 
              { backgroundColor: '#15234b', maxWidth: cardMaxWidth },
              isCards && { flex: 1, width: '100%', maxHeight: '100%', justifyContent: 'space-between' }
            ]}>
              <View style={[styles.topSection, isCards && { flex: 1, justifyContent: 'space-between', padding: isTablet ? 28 : 14 }]}>
                 <Text style={[leagueTextStyle, isCards && { fontSize: isTablet ? 24 : 16, marginBottom: isTablet ? 14 : 6 }]}>LATEST UPDATES • {currentItem.data.date}</Text>
                 <View style={[styles.newsRow, isCards && { flex: 1, justifyContent: 'center', paddingVertical: isTablet ? 14 : 8 }]}>
                    <Text 
                      style={[
                        styles.newsHeadline, 
                        isTablet && { fontSize: 40, lineHeight: 52 },
                        isCards && { 
                          fontSize: isTablet ? 62 : 36, 
                          lineHeight: isTablet ? 78 : 44,
                          fontWeight: '800'
                        }
                      ]}
                      numberOfLines={isCards ? (isTablet ? 4 : 3) : undefined}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                    >
                      {currentItem.data.title}
                    </Text>
                 </View>
              </View>
              <View style={[styles.playSection, isCards && { paddingHorizontal: isTablet ? 28 : 14, paddingBottom: isTablet ? 20 : 10 }]}>
                <View style={[styles.playBar, isCards && { height: isTablet ? 26 : 18, width: isTablet ? 5 : 3 }]} />
                <Text style={[styles.playText, isTablet && { fontSize: 20 }, isCards && { fontSize: isTablet ? 22 : 16 }]}>Source: {currentItem.data.source}</Text>
              </View>
              <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.3)' }]} />
            </View>
          ) : currentItem.type === 'WEATHER' ? (
            <LinearGradient 
              colors={currentItem.data.backgroundColor || ['#4A76E1', '#4A76E1']} 
              style={[
                styles.card, 
                styles.weatherCard, 
                { maxWidth: cardMaxWidth, overflow: 'hidden' },
                isCards && { flex: 1, width: '100%', maxHeight: '100%', padding: isTablet ? 26 : 12, justifyContent: 'space-between' }
              ]}
            >
              <WeatherVisuals code={currentItem.data.code} isDay={currentItem.data.isDay} />
              <View style={[{ position: 'relative', zIndex: 2, width: '100%' }, isCards && { flex: 1, justifyContent: 'space-between' }]}>
                <View style={[styles.weatherHeader, isCards && { marginBottom: isTablet ? 14 : 6 }]}>
                  <View style={styles.weatherTitleGroup}>
                    <Text style={[styles.weatherLocation, isCards && { fontSize: isTablet ? 26 : 18, letterSpacing: 2 }]}>
                      {currentItem.data.city}<Text style={styles.weatherLocationIcon}> ↗</Text>
                    </Text>
                  </View>
                  <View style={[styles.weatherIconWrap, isCards && isTablet && { width: 64, height: 64, borderRadius: 32 }]}>
                    <Text style={[styles.weatherEmoji, isCards && isTablet && { fontSize: 38 }]}>{currentItem.data.icon}</Text>
                  </View>
                </View>
                <View style={[styles.weatherMain, isCards && { marginVertical: isTablet ? 12 : 4 }]}>
                  <Text style={[
                    styles.weatherTemp, 
                    isTablet && { fontSize: 120, lineHeight: 120 },
                    isCards && { fontSize: isTablet ? 146 : 90, lineHeight: isTablet ? 146 : 90, fontWeight: '900' }
                  ]}>
                    {currentItem.data.temperature}
                  </Text>
                  <View style={styles.weatherDetails}>
                    <Text style={[
                      styles.weatherConditionLarge, 
                      isTablet && { fontSize: 24 },
                      isCards && { fontSize: isTablet ? 34 : 22, marginBottom: 4 }
                    ]}>
                      {currentItem.data.condition}
                    </Text>
                    <Text style={[
                      styles.weatherHiLo, 
                      isTablet && { fontSize: 18 },
                      isCards && { fontSize: isTablet ? 22 : 15 }
                    ]}>
                      H:{currentItem.data.high}  L:{currentItem.data.low}
                    </Text>
                    <Text style={[
                      styles.weatherHiLo, 
                      isTablet && { fontSize: 18 }, 
                      { marginTop: 6, opacity: 0.8 },
                      isCards && { fontSize: isTablet ? 22 : 15, marginTop: 4 }
                    ]}>
                      Feels like: {currentItem.data.feelsLike}
                    </Text>
                  </View>
                </View>
                <View style={[styles.forecastRow, isCards && { marginTop: isTablet ? 16 : 8 }]}>
                  {currentItem.data.forecast.map((item, idx) => (
                    <View key={`${item.label}-${idx}`} style={[styles.forecastItem, isCards && isTablet && { paddingHorizontal: 16 }]}>
                      <Text style={[styles.forecastTime, isTablet && { fontSize: 16 }, isCards && { fontSize: isTablet ? 18 : 13 }]}>{item.label}</Text>
                      <Text style={[styles.forecastIcon, isTablet && { fontSize: 26 }, isCards && { fontSize: isTablet ? 36 : 24 }]}>{item.icon}</Text>
                      <Text style={[styles.forecastTemp, isTablet && { fontSize: 24 }, isCards && { fontSize: isTablet ? 28 : 20 }]}>{item.temp}°</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.22)', zIndex: 3 }]} />
            </LinearGradient>
          ) : currentItem.type === 'FREETEXT' ? ( // Use a distinct color for Free Text
            <View style={[
              styles.card, 
              styles.rssCard, 
              { maxWidth: cardMaxWidth },
              isCards && { flex: 1, width: '100%', maxHeight: '100%', justifyContent: 'space-between' }
            ]}>
              <View style={[styles.topSection, isCards && { flex: 1, padding: isTablet ? 26 : 14 }]}>
                 <Text style={[leagueTextStyle, isCards && { fontSize: isTablet ? 22 : 16, marginBottom: isTablet ? 12 : 6 }]}>FROM {currentItem.data.source ? currentItem.data.source.toUpperCase() : 'RSS'}</Text>
                 {currentItem.data.body ? (
                   <View style={[styles.rssContentContainer, isCards && { flex: 1, justifyContent: 'space-around' }]}>
                     {currentItem.data.pageNumber > 1 ? (
                       <Text 
                         style={[
                           styles.rssTitleCont, 
                           isTablet && styles.rssTitleContTablet,
                           isCards && { fontSize: isTablet ? 32 : 20, lineHeight: isTablet ? 40 : 26 }
                         ]} 
                         numberOfLines={2}
                         adjustsFontSizeToFit
                       >
                         {currentItem.data.title}
                       </Text>
                     ) : (
                       <Text 
                         style={[
                           styles.rssTitle, 
                           isTablet && styles.rssTitleTablet,
                           isCards && { fontSize: isTablet ? 44 : 26, lineHeight: isTablet ? 54 : 32 }
                         ]} 
                         numberOfLines={2}
                         adjustsFontSizeToFit
                       >
                         {currentItem.data.title}
                       </Text>
                     )}
                     <View style={[styles.rssBodyContainer, isCards && { gap: isTablet ? 10 : 5, marginTop: isTablet ? 10 : 4 }]}>
                       {currentItem.data.body.split(/\n\n+/).filter(Boolean).map((para, pIdx) => (
                         <Text 
                           key={pIdx} 
                           style={[
                             styles.rssBodyParagraph, 
                             isTablet && styles.rssBodyParagraphTablet,
                             isCards && { fontSize: isTablet ? 24 : 16, lineHeight: isTablet ? 34 : 24 }
                           ]} 
                           adjustsFontSizeToFit
                         >
                           {para}
                         </Text>
                       ))}
                     </View>
                   </View>
                 ) : (
                   <View style={[styles.newsRow, isCards && { flex: 1, justifyContent: 'center' }]}>
                      <Text 
                        style={[
                          styles.newsHeadline, 
                          isTablet && { fontSize: 40, lineHeight: 52 },
                          isCards && { fontSize: isTablet ? 62 : 36, lineHeight: isTablet ? 78 : 44, fontWeight: '800' }
                        ]}
                        adjustsFontSizeToFit
                        minimumFontScale={0.65}
                      >
                        {currentItem.data.title}
                      </Text>
                   </View>
                 )}
              </View>
              <View style={[styles.playSection, isCards && { paddingHorizontal: isTablet ? 26 : 14, paddingBottom: isTablet ? 20 : 10 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <View style={[styles.playBar, isCards && { height: isTablet ? 24 : 16, width: isTablet ? 5 : 3 }]} />
                  <Text style={[styles.playText, isTablet && { fontSize: 20 }, isCards && { fontSize: isTablet ? 22 : 16 }]}>{currentItem.data.date}</Text>
                </View>
                {currentItem.data.pageTotal > 1 && (
                  <View style={[styles.rssPageBadge, isCards && { paddingHorizontal: isTablet ? 16 : 8, paddingVertical: isTablet ? 6 : 3 }]}>
                    <Text style={[styles.rssPageText, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 20 : 14 }]}>
                      {`${currentItem.data.pageNumber}/${currentItem.data.pageTotal}`}
                    </Text>
                  </View>
                )}
              </View>
              <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.3)' }]} />
            </View>
          ) : currentItem.type === 'NFL_DRAFT' ? (
            <View style={[
              styles.card, 
              { backgroundColor: '#013369', maxWidth: cardMaxWidth },
              isCards && { flex: 1, width: '100%', maxHeight: '100%', justifyContent: 'space-between' }
            ]}>
              <View style={[styles.topSection, isCards && { flex: 1, padding: isTablet ? 24 : 12 }]}>
                 <Text style={[leagueTextStyle, isCards && { fontSize: isTablet ? 22 : 16, marginBottom: isTablet ? 12 : 6 }]}>{currentItem.data.year} NFL DRAFT LATEST PICKS</Text>
                 <View style={[styles.draftContainer, isCards && { flex: 1, justifyContent: 'space-around' }]}>
                    {currentItem.data.recentPicks?.length > 0 ? (
                      currentItem.data.recentPicks.map((pick, index) => (
                         <View key={`draft-${index}`} style={[styles.draftRow, isTablet && { padding: 18 }, isCards && isTablet && { padding: 16 }]}>
                            <Text style={[styles.draftPickNum, isTablet && { fontSize: 26, width: 55 }, isCards && isTablet && { fontSize: 28, width: 60 }]}>{pick.pick}.</Text>
                            <Image source={{ uri: pick.team?.logo || 'https://a.espncdn.com/i/teamlogos/nfl/500/nfl.png' }} style={[styles.draftTeamLogo, isTablet && { width: 50, height: 50, marginRight: 20 }, isCards && isTablet && { width: 54, height: 54, marginRight: 18 }]} resizeMode="contain" />
                            <View style={styles.draftPlayerInfo}>
                               <Text style={[styles.draftPlayerName, isTablet && { fontSize: 24 }, isCards && { fontSize: isTablet ? 26 : 18 }]}>{pick.player.name}</Text>
                               <Text style={[styles.draftPlayerDetails, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 20 : 14 }]}>
                                  {pick.player.position}
                                  {pick.trade && <Text style={[styles.draftTradeText, isTablet && { fontSize: 15 }, isCards && { fontSize: isTablet ? 16 : 12 }]}> • 🔄 {pick.trade}</Text>} • {pick.player.college}
                                </Text>
                            </View>
                         </View>
                      ))
                    ) : (
                       <View style={[styles.draftRow, { justifyContent: 'center', paddingVertical: 40 }]}>
                          <Text style={{ color: '#EBEBF5', fontSize: 18, fontWeight: 'bold' }}>No picks have been made yet.</Text>
                       </View>
                    )}
                 </View>
              </View>
              <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.3)' }]} />
            </View>
          ) : currentItem.type === 'SCOREBOARD' ? (
            <View style={[
              styles.card, 
              { backgroundColor: '#15234b', maxWidth: cardMaxWidth },
              isCards && { flex: 1, width: '100%', maxHeight: '100%', justifyContent: 'space-between' }
            ]}>
              <View style={[styles.topSection, isCards && { flex: 1, paddingHorizontal: isTablet ? 20 : 10, paddingVertical: isTablet ? 10 : 6, justifyContent: 'space-between' }]}>
                 <Text style={[leagueTextStyle, isCards && { fontSize: isTablet ? 22 : 16, letterSpacing: 2, marginBottom: isTablet ? 8 : 4 }]}>{currentItem.data.headerText || `${formatLeagueName(currentItem.data.targetLeague)} LATEST SCORES`}</Text>
                  <View style={[
                     styles.scoreboardGrid, 
                     { gap: isSmallDevice ? 4 : isTablet ? (isCards ? 10 : 12) : 6 }, 
                     isCards && { 
                       flex: 1, 
                       alignContent: isTablet ? 'flex-start' : 'space-evenly',
                       justifyContent: 'space-evenly', 
                       paddingBottom: 0, 
                       marginTop: 0 
                     }
                   ]}>
                    {currentItem.data.events.length > 0 ? currentItem.data.events.map((ev, index) => {
                       const count = currentItem.data.events.length;
                       
                       return (
                       <View key={`score-${ev.id}-${index}`} style={[
                         styles.scoreboardCell, 
                         isSmallDevice && { padding: 6, marginBottom: 3 }, 
                         isTablet && { width: '31.5%', padding: 14 },
                         isCards && (
                           isTablet 
                             ? { 
                                 width: count <= 2 ? '48%' : '23.8%', 
                                 paddingVertical: count <= 2 ? 18 : 14, 
                                 paddingHorizontal: count <= 2 ? 16 : 12,
                                 borderRadius: 14,
                                 marginBottom: 6
                               }
                             : { 
                                 width: count > 4 ? '31.8%' : '48%', 
                                 paddingVertical: 6, 
                                 paddingHorizontal: 6,
                                 borderRadius: 10,
                                 marginBottom: 3
                               }
                         )
                       ]}>
                          <View style={[styles.scoreboardRow, isCards && { marginBottom: isTablet ? 5 : 3 }]}>
                             <Image 
                                source={{ uri: ev.away.logo }} 
                                style={[
                                  styles.scoreLogo, 
                                  getSmartLogoStyle(ev.away.logo, '#15234b'), 
                                  isSmallDevice && { width: 16, height: 16, marginRight: 4 }, 
                                  isTablet && { width: 26, height: 26, marginRight: 8 }, 
                                  isCards && { 
                                    width: isTablet ? (count <= 2 ? 46 : 42) : 24, 
                                    height: isTablet ? (count <= 2 ? 46 : 42) : 24, 
                                    marginRight: isTablet ? 10 : 6 
                                  }
                                ]} 
                                resizeMode="contain" 
                              />
                              <Text 
                                style={[
                                  styles.scoreAbbr, 
                                  isSmallDevice && { fontSize: 12 }, 
                                  isTablet && { fontSize: 16 }, 
                                  isCards && { 
                                    fontSize: isTablet ? 24 : 15, 
                                    fontWeight: '800' 
                                  }
                                ]} 
                                numberOfLines={1}
                              >
                                {ev.away.rank ? <Text style={[styles.scoreRank, isSmallDevice && { fontSize: 8 }, isTablet && { fontSize: 10 }, isCards && { fontSize: isTablet ? 14 : 9 }]}>{ev.away.rank} </Text> : null}
                                {ev.away.abbr}
                              </Text>
                              <Text 
                                style={[
                                  styles.scorePts, 
                                  ev.away.winner && styles.scoreWinner, 
                                  isSmallDevice && { fontSize: 15 }, 
                                  isTablet && { fontSize: 22 }, 
                                  isCards && { 
                                    fontSize: isTablet ? 38 : 22, 
                                    fontWeight: '900' 
                                  }
                                ]} 
                              >
                                {ev.away.score}
                              </Text>
                          </View>
                          <View style={[styles.scoreboardRow, isCards && { marginBottom: isTablet ? 5 : 3 }]}>
                             <Image 
                                source={{ uri: ev.home.logo }} 
                                style={[
                                  styles.scoreLogo, 
                                  getSmartLogoStyle(ev.home.logo, '#15234b'), 
                                  isSmallDevice && { width: 16, height: 16, marginRight: 4 }, 
                                  isTablet && { width: 26, height: 26, marginRight: 8 }, 
                                  isCards && { 
                                    width: isTablet ? (count <= 2 ? 46 : 42) : 24, 
                                    height: isTablet ? (count <= 2 ? 46 : 42) : 24, 
                                    marginRight: isTablet ? 10 : 6 
                                  }
                                ]} 
                                resizeMode="contain" 
                              />
                              <Text 
                                style={[
                                  styles.scoreAbbr, 
                                  isSmallDevice && { fontSize: 12 }, 
                                  isTablet && { fontSize: 16 }, 
                                  isCards && { 
                                    fontSize: isTablet ? 24 : 15, 
                                    fontWeight: '800' 
                                  }
                                ]} 
                                numberOfLines={1}
                              >
                                {ev.home.rank ? <Text style={[styles.scoreRank, isSmallDevice && { fontSize: 8 }, isTablet && { fontSize: 10 }, isCards && { fontSize: isTablet ? 14 : 9 }]}>{ev.home.rank} </Text> : null}
                                {ev.home.abbr}
                              </Text>
                              <Text 
                                style={[
                                  styles.scorePts, 
                                  ev.home.winner && styles.scoreWinner, 
                                  isSmallDevice && { fontSize: 15 }, 
                                  isTablet && { fontSize: 22 }, 
                                  isCards && { 
                                    fontSize: isTablet ? 38 : 22, 
                                    fontWeight: '900' 
                                  }
                                ]} 
                              >
                                {ev.home.score}
                              </Text>
                          </View>
                          <Text 
                            style={[
                              styles.scoreStatus, 
                              isSmallDevice && { fontSize: 8, marginTop: 1 }, 
                              isTablet && { fontSize: 11, marginTop: 3 }, 
                              isCards && { 
                                fontSize: isTablet ? 15 : 11, 
                                marginTop: isTablet ? 2 : 1, 
                                fontWeight: '700' 
                              }
                            ]} 
                            numberOfLines={1} 
                            adjustsFontSizeToFit
                          >
                            {ev.status}
                          </Text>
                       </View>
                       );
                    }) : (
                       <View style={{ paddingVertical: 40, alignItems: 'center', width: '100%' }}>
                          <Text style={{ color: '#EBEBF5', fontSize: 18, fontWeight: 'bold' }}>No active games available.</Text>
                       </View>
                    )}
                 </View>
              </View>
              <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.3)' }]} />
            </View>
          ) : (
            <View style={[{ alignItems: 'center', width: '100%' }, (isCards || !isTablet) && { flex: 1, justifyContent: 'center' }]}>
              <View 
                style={[
                  styles.card, 
                  { backgroundColor: dynamicCardColor, maxWidth: cardMaxWidth },
                  currentItem.data.teamBorderColor && { borderWidth: 2, borderColor: currentItem.data.teamBorderColor },
                  isCards && { 
                    flex: 1, 
                    width: '100%', 
                    maxHeight: '100%', 
                    justifyContent: 'space-between' 
                  }
                ]}
              > 
                
                <View style={[
                  styles.topSection, 
                  isCards && { 
                    flex: 1, 
                    justifyContent: 'space-between', 
                    padding: isTablet ? (currentItem.data.potgRunnerUps?.length > 0 ? 16 : 24) : 12 
                  }
                ]}>
                  <Text style={[leagueTextStyle, isCards && { fontSize: isTablet ? 22 : 15, marginBottom: isTablet ? (currentItem.data.potgRunnerUps?.length > 0 ? 8 : 12) : 6 }]} numberOfLines={1} adjustsFontSizeToFit>{formatLeagueName(currentItem.data.league)} • {currentItem.data.date}</Text>
                  
                  <View style={[styles.scoreRow, isCards && { flex: 1, alignItems: 'center' }]}>
                    {/* Away Team */}
                    <View style={styles.teamColLeft}>
                      <View style={[styles.teamRow, isCards && isTablet && { gap: currentItem.data.potgRunnerUps?.length > 0 ? 16 : 24 }]}>
                         {currentItem.data.awayLogo && (
                           <View style={[styles.logoWrapper, currentItem.data.awayWinner && styles.logoWinner, isTablet && { width: 96, height: 96 }, isCards && isTablet && { width: currentItem.data.potgRunnerUps?.length > 0 ? 96 : 124, height: currentItem.data.potgRunnerUps?.length > 0 ? 96 : 124 }]}>
                             <Image source={{ uri: currentItem.data.awayLogo }} style={[styles.teamLogo, getSmartLogoStyle(currentItem.data.awayLogo, dynamicCardColor), isTablet && { width: 72, height: 72 }, isCards && isTablet && { width: currentItem.data.potgRunnerUps?.length > 0 ? 74 : 100, height: currentItem.data.potgRunnerUps?.length > 0 ? 74 : 100 }]} resizeMode="contain" />
                           </View>
                         )}
                        <Text style={[
                          styles.scoreNum, 
                          currentItem.data.awayWinner && styles.scoreWinner, 
                          isTablet && { fontSize: 80 }, 
                          layoutMode === 'zoomed' && { fontSize: isTablet ? 120 : 84 },
                          isCards && { fontSize: isTablet ? (currentItem.data.potgRunnerUps?.length > 0 ? 92 : 130) : 72, fontWeight: '900' }
                        ]}>
                          {currentItem.data.awayScore}
                        </Text>
                      </View>
                      <Text style={[styles.teamName, isTablet && { fontSize: 24 }, isCards && { fontSize: isTablet ? (currentItem.data.potgRunnerUps?.length > 0 ? 26 : 32) : 22, fontWeight: '800' }]} numberOfLines={1} adjustsFontSizeToFit>
                        {currentItem.data.awayRank ? <Text style={[styles.teamRank, isTablet && { fontSize: 14 }, isCards && { fontSize: isTablet ? 18 : 12 }]}>{currentItem.data.awayRank} </Text> : null}
                        {currentItem.data.awayAbbr}
                      </Text>
                      <Text style={[styles.teamRecord, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 22 : 16 }]}>{currentItem.data.awayRecord || '0-0'}</Text>
                    </View>

                    {/* Center Status */}
                    <View style={styles.centerCol}>
                      {currentItem.data.league === 'MLB' && currentItem.data.situation ? (
                        <View style={styles.mlbLiveStatus}>
                          <Text style={[styles.mlbCountText, isTablet && { fontSize: 16 }, isCards && { fontSize: isTablet ? 20 : 14 }]}>{`${currentItem.data.situation.balls}-${currentItem.data.situation.strikes}  •  ${currentItem.data.situation.outs} out${currentItem.data.situation.outs !== 1 ? 's' : ''}`}</Text>
                          <View style={styles.basesContainer}>
                            <View style={[styles.base, currentItem.data.situation.onSecond && styles.baseActive, styles.baseTop, isTablet && { width: 14, height: 14 }, isCards && isTablet && { width: 18, height: 18 }]} />
                            <View style={styles.basesRow}>
                              <View style={[styles.base, currentItem.data.situation.onThird && styles.baseActive, isTablet && { width: 14, height: 14 }, isCards && isTablet && { width: 18, height: 18 }]} />
                              <View style={[styles.base, currentItem.data.situation.onFirst && styles.baseActive, isTablet && { width: 14, height: 14 }, isCards && isTablet && { width: 18, height: 18 }]} />
                            </View>
                          </View>
                          <Text style={[styles.mlbInningText, isTablet && { fontSize: 20 }, isCards && { fontSize: isTablet ? 24 : 16, fontWeight: '700' }]}>{currentItem.data.status}</Text>
                        </View>
                      ) : (
                        <View style={styles.centerStatusFallback}>
                          <View style={styles.dotsRow}>
                            <View style={styles.dot} /><View style={styles.dot} /><View style={styles.dot} />
                          </View>
                          <Text style={[styles.statusText, currentItem.data.situation && { color: '#FFD700' }, isTablet && { fontSize: 20 }, isCards && { fontSize: isTablet ? 24 : 16, fontWeight: '700' }]}>{currentItem.data.status}</Text>
                        </View>
                      )}
                    </View>
                    {/* Home Team */}
                    <View style={styles.teamColRight}>
                      <View style={[styles.teamRow, { justifyContent: 'flex-end' }, isCards && isTablet && { gap: currentItem.data.potgRunnerUps?.length > 0 ? 16 : 24 }]}>
                         <Text style={[
                           styles.scoreNum, 
                           currentItem.data.homeWinner && styles.scoreWinner, 
                           isTablet && { fontSize: 80 }, 
                           layoutMode === 'zoomed' && { fontSize: isTablet ? 120 : 84 },
                           isCards && { fontSize: isTablet ? (currentItem.data.potgRunnerUps?.length > 0 ? 92 : 130) : 72, fontWeight: '900' }
                         ]}>
                           {currentItem.data.homeScore}
                         </Text>
                         {currentItem.data.homeLogo && (
                           <View style={[styles.logoWrapper, currentItem.data.homeWinner && styles.logoWinner, isTablet && { width: 96, height: 96 }, isCards && isTablet && { width: currentItem.data.potgRunnerUps?.length > 0 ? 96 : 124, height: currentItem.data.potgRunnerUps?.length > 0 ? 96 : 124 }]}>
                             <Image source={{ uri: currentItem.data.homeLogo }} style={[styles.teamLogo, getSmartLogoStyle(currentItem.data.homeLogo, dynamicCardColor), isTablet && { width: 72, height: 72 }, isCards && isTablet && { width: currentItem.data.potgRunnerUps?.length > 0 ? 74 : 100, height: currentItem.data.potgRunnerUps?.length > 0 ? 74 : 100 }]} resizeMode="contain" />
                           </View>
                         )}
                      </View>
                      <Text style={[styles.teamNameRight, isTablet && { fontSize: 24 }, isCards && { fontSize: isTablet ? (currentItem.data.potgRunnerUps?.length > 0 ? 26 : 32) : 22, fontWeight: '800' }]} numberOfLines={1} adjustsFontSizeToFit>
                        {currentItem.data.homeRank ? <Text style={[styles.teamRank, isTablet && { fontSize: 14 }, isCards && { fontSize: isTablet ? 18 : 12 }]}>{currentItem.data.homeRank} </Text> : null}
                        {currentItem.data.homeAbbr}
                      </Text>
                      <Text style={[styles.teamRecordRight, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 22 : 16 }]}>{currentItem.data.homeRecord || '0-0'}</Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.playSection, isCards && { paddingHorizontal: isTablet ? 26 : 14, paddingBottom: isTablet ? 14 : 6 }]}>
                  <View style={[styles.playBar, isCards && { height: isTablet ? 22 : 14, width: isTablet ? 4 : 3 }]} />
                  <Text style={[styles.playText, isTablet && { fontSize: 20 }, isCards && { fontSize: isTablet ? 20 : 14 }]} numberOfLines={2} ellipsizeMode="tail">{currentItem.data.topPlay}</Text>
                </View>

                <View style={styles.playerSection}>
                  <View style={[styles.playerSectionHeaderWrap, isCards && { paddingVertical: isTablet ? 8 : 4 }]}>
                    <Text style={[styles.playerSectionHeader, isTablet && { fontSize: 16 }, isCards && { fontSize: isTablet ? 18 : 13 }]}>{currentItem.data.playerSectionHeader || 'PLAYER OF THE GAME'}</Text>
                  </View>
                  <View style={[styles.playerSectionBody, isCards && { padding: isTablet ? 14 : 8 }]}>
                     <Text style={[styles.playerName, isTablet && { fontSize: 24 }, isCards && { fontSize: isTablet ? 26 : 18 }]}>{currentItem.data.playerGlance.name}</Text>
                     <Text style={[styles.playerSubtext, isTablet && { fontSize: 18 }, isCards && { fontSize: isTablet ? 18 : 14 }]}>{currentItem.data.playerGlance.subtext}</Text>
                     <Text
                      style={[styles.playerStatsRow, isTablet && { fontSize: 22 }, isCards && { fontSize: isTablet ? 22 : 16 }]}
                      numberOfLines={currentItem.data.playerSectionHeader === 'AT-BAT' ? 5 : 2}
                      adjustsFontSizeToFit
                      ellipsizeMode="tail"
                    >{currentItem.data.playerGlance.stats}</Text>
                  </View>
                </View>

                <Animated.View style={[styles.progressBar, { width: interpolatedWidth, backgroundColor: 'rgba(255, 255, 255, 0.4)' }]} />

              </View>

              {/* Anchor Honorable Mentions right here! */}
              {isTablet && currentItem.data.potgRunnerUps && currentItem.data.potgRunnerUps.length > 0 && (
                  <View style={[
                    styles.runnerUpContainer, 
                    { maxWidth: cardMaxWidth, width: '100%' },
                    isCards && { marginTop: 6, paddingVertical: 8, paddingHorizontal: 16 }
                  ]}>
                      <Text style={[styles.runnerUpHeader, isCards && { fontSize: 13, marginBottom: 4 }]}>HONORABLE MENTIONS</Text>
                      {currentItem.data.potgRunnerUps.map((player, index) => (
                          <View key={`runnerup-${index}`} style={[styles.runnerUpRow, isCards && { paddingVertical: 3 }]}>
                              <Text style={[styles.runnerUpName, isCards && { fontSize: 15 }]} numberOfLines={1}>{`${index + 2}. ${player.name}${player.teamAbbr ? ` (${player.teamAbbr})` : ''}`}</Text>
                              <Text style={[styles.runnerUpStats, isCards && { fontSize: 14 }]} numberOfLines={1} ellipsizeMode="tail">{player.stats}</Text>
                              <Text style={[styles.runnerUpScore, isCards && { fontSize: 14 }]}>{String(player.mvpScore).includes('Star') ? player.mvpScore : `MVP: ${player.mvpScore}`}</Text>
                          </View>
                      ))}
                  </View>
              )}

            </View>
          )}

        </Animated.View>
      </View>
      </View>

      </View>

      {isTablet && !showZmanimInFooter && (
          <View style={styles.cycleIndicatorWrapper}>
            <ScrollView ref={indicatorScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cycleIndicatorContainer}>
              {displayCycle.map((item, idx) => {
                const isCurrent = (currentIndex % displayCycle.length) === idx;
                let iconContent = null;
                if (item.type === 'WEATHER') iconContent = <Text style={styles.cycleIconText}>☀️</Text>;
                else if (item.type === 'NEWS') iconContent = <Text style={styles.cycleIconText}>📰</Text>;
                else if (item.type === 'FREETEXT') iconContent = <Text style={styles.cycleIconText}>✍️</Text>;
                else if (item.type === 'NFL_DRAFT') iconContent = <Image source={{ uri: 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png' }} style={styles.cycleIconImage} resizeMode="contain" />;
                else if (item.type === 'CLOCK') iconContent = <Text style={styles.cycleIconText}>🕒</Text>;
                else if (item.type === 'ZMANIM') iconContent = <Text style={styles.cycleIconText}>🕯️</Text>;
                else if (item.type === 'PARSHA') iconContent = <Text style={styles.cycleIconText}>📜</Text>;
                else if (item.type === 'STANDINGS') {
                  if (item.data?.logo) {
                    iconContent = <Image source={{ uri: item.data.logo }} style={styles.cycleIconImage} resizeMode="contain" />;
                  } else {
                    iconContent = <Text style={styles.cycleIconText}>📊</Text>;
                  }
                }
                else if (item.type === 'SCOREBOARD' || item.type === 'SPORTS') {
                  const lg = item.type === 'SCOREBOARD' ? item.data.targetLeague.toLowerCase() : item.data.league.toLowerCase();
                  if (lg === 'pwhl') {
                    iconContent = <Image source={{ uri: 'https://cdn.harianbasis.co/media/images/2026/05/HeWKBAB5QG.jpeg?location=1&width=&height=&quality=90&fit=1' }} style={styles.cycleIconImage} resizeMode="contain" />;
                  } else if (lg === 'college-football' || lg === 'ncaaf' || lg === 'ncaa') {
                    iconContent = <Image source={{ uri: 'https://a.espncdn.com/i/espn/misc_logos/500/ncaa.png' }} style={styles.cycleIconImage} resizeMode="contain" />;
                  } else if (lg === 'usa.1' || lg === 'mls') {
                    iconContent = <Image source={{ uri: 'https://cdn.freebiesupply.com/images/large/2x/mls-logo-png-transparent.png' }} style={styles.cycleIconImage} resizeMode="contain" />;
                  } else if (lg === 'eng.1' || lg === 'epl') {
                    iconContent = <Image source={{ uri: 'https://www.thesun.co.uk/wp-content/uploads/2022/01/logo-2-1.png' }} style={styles.cycleIconImage} resizeMode="contain" />;
                  } else if (lg === 'fifa.world') {
                    iconContent = <Text style={styles.cycleIconText}>⚽</Text>;
                  } else {
                    iconContent = <Image source={{ uri: `https://a.espncdn.com/i/teamlogos/leagues/500/${lg}.png` }} style={styles.cycleIconImage} resizeMode="contain" />;
                  }
                }
                return (
                  <View key={`indicator-${idx}`} style={[styles.cycleIconWrapper, isCurrent && styles.cycleIconWrapperActive]}>
                    {iconContent}
                  </View>
                );
              })}
            </ScrollView>
          </View>
      )}
      {isTablet && showZmanimInFooter && (
          <View style={styles.zmanimFooter}>
            <Text style={styles.zmanimFooterText} numberOfLines={1} adjustsFontSizeToFit>
              {upcomingZmanim.map(z => `${z.label}: ${z.time}`).join('   •   ')}
            </Text>
          </View>
      )}

      {showSetupButton && (
        <TouchableOpacity style={styles.floatingSetupButton} onPress={onSetup}>
          <Text style={styles.floatingSetupButtonText}>⚙️ Setup ({setupCountdown})</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

function SettingsScreen({ currentPreferences, onSave, onChangeFormat }) {
  const [format, setFormat] = useState(currentPreferences?.format || 'classic');
  const [selected, setSelected] = useState(currentPreferences?.teams || []);
  const isCards = format === 'cards';
  const setupItems = getSetupItems(format);
  const leagues = [...new Set(setupItems.map(t => formatLeagueName(t.league)))].filter(
    l => l !== 'FREE TEXT' && l !== 'FREETEXT' && l !== 'STANDINGS' && l !== 'ESSENTIALS'
  );
  const [expandedLeagues, setExpandedLeagues] = useState({
    Essentials: true,
    Standings: false
  });
  const [showQrModal, setShowQrModal] = useState(false);
  const [isSavingRemote, setIsSavingRemote] = useState(false);
  const [customRssUrl, setCustomRssUrl] = useState('');
  const [customRssName, setCustomRssName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [zmanimLayout, setZmanimLayout] = useState(currentPreferences?.zmanimLayout || 'standard');

  const openRemoteSetup = async () => {
    const newPrefs = {
      format,
      teams: selected,
      zmanimLayout,
    };
    try {
      setIsSavingRemote(true);
      await onSave(newPrefs, false, false);
    } finally {
      setIsSavingRemote(false);
      setShowQrModal(true);
    }
  };

  useEffect(() => {
    setFormat(currentPreferences?.format || 'classic');
    setSelected(currentPreferences?.teams || []);
    setZmanimLayout(currentPreferences?.zmanimLayout || 'standard');
  }, [currentPreferences]);
  
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // A more robust way to detect a tablet, independent of orientation.
  // If the smaller dimension is larger than a typical phone's larger dimension, it's a tablet.
  const isTablet = Math.min(windowWidth, windowHeight) >= 768;

  const toggleTeam = (team) => {
    if (selected.some(s => s.id === team.id)) {
      setSelected(selected.filter(s => s.id !== team.id));
    } else {
      setSelected([...selected, team]);
      setSearchQuery('');
    }
  };

  const toggleLeague = (league) => {
    setExpandedLeagues(prev => ({ ...prev, [league]: !prev[league] }));
  };

  const handleSave = () => {
    onSave({ format, teams: selected, zmanimLayout });
  };

  const addCustomFeed = () => {
    if (customRssUrl && customRssName) {
      const newFeed = {
        id: `news-custom-${uuidv4()}`,
        league: 'freetext',
        name: customRssName,
        url: customRssUrl,
      };
      setSelected(prev => [...prev, newFeed]);
      setCustomRssUrl('');
      setCustomRssName('');
    }
  };

  const selectedIds = selected.map(s => s.id);

  const isSearching = searchQuery.trim().length > 0;
  const searchResults = isSearching 
    ? setupItems.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase()) || (t.abbr && t.abbr.toLowerCase().includes(searchQuery.toLowerCase())))
    : [];

  return (
    <SafeAreaView style={styles.settingsWrapper}>
      <RemoteSetupScreen 
        visible={showQrModal}
        onClose={() => setShowQrModal(false)}
      />
      <KeyboardAvoidingView 
        style={{ flex: 1, width: '100%', alignItems: 'center' }} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Format Selector Banner */}
        <View style={styles.formatBanner}>
          <View style={styles.formatBannerInfo}>
            <Text style={styles.formatBannerLabel}>DISPLAY FORMAT</Text>
            <Text style={styles.formatBannerValue}>
              {isCards ? '🎴 Cards (Full-Screen)' : '⏱️ Classic (Dashboard)'}
            </Text>
          </View>
          <View style={styles.formatBannerActions}>
            <TouchableOpacity 
              style={[styles.formatToggleTab, !isCards && styles.formatToggleTabActive]} 
              onPress={() => setFormat('classic')}
            >
              <Text style={[styles.formatToggleTabText, !isCards && styles.formatToggleTabTextActive]}>Classic</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.formatToggleTab, isCards && styles.formatToggleTabActive]} 
              onPress={() => setFormat('cards')}
            >
              <Text style={[styles.formatToggleTabText, isCards && styles.formatToggleTabTextActive]}>Cards</Text>
            </TouchableOpacity>
            {onChangeFormat && (
              <TouchableOpacity style={styles.formatDetailBtn} onPress={onChangeFormat}>
                <Text style={styles.formatDetailBtnText}>Change ⚙️</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.settingsHeader}>{isCards ? 'Select Cards & Items' : 'Select Your Teams'}</Text>
        
        <TextInput
          style={styles.searchInput}
          placeholder={isCards ? "Search cards, standings, teams, news..." : "Search for teams, news, or leagues..."}
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
        />

        <ScrollView style={styles.settingsList}>
          {selected.length > 0 && (
            <View style={styles.leagueSection}>
              <View style={styles.leagueHeaderContainer}>
                <Text style={styles.leagueHeader}>SELECTED ITEMS</Text>
                <TouchableOpacity onPress={() => setSelected([])}>
                  <Text style={styles.clearAllText}>Clear All</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.selectedTagsContainer}>
                {selected.map((team, index) => (
                  <TouchableOpacity key={`selected-${team.id}`} style={styles.selectedTag} onPress={() => toggleTeam(team)}>
                    <Text style={styles.selectedTagText}>{team.name}  ✕</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {isSearching ? (
            <View style={styles.leagueSection}>
              <View style={styles.leagueHeaderContainer}>
                <Text style={styles.leagueHeader}>SEARCH RESULTS</Text>
              </View>
              {searchResults.map(team => (
                <TouchableOpacity 
                  key={`search-${team.id}`} 
                  style={[styles.settingsItem, selectedIds.includes(team.id) && styles.settingsItemSelected]}
                  onPress={() => toggleTeam(team)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingsItemText}>{team.name} <Text style={{opacity: 0.6, fontSize: 14}}>({formatLeagueName(team.league)})</Text></Text>
                    {team.description ? <Text style={styles.settingsItemSubtext}>{team.description}</Text> : null}
                  </View>
                  <Text style={{ fontSize: 18, color: selectedIds.includes(team.id) ? '#0A84FF' : '#666', fontWeight: 'bold' }}>
                    {selectedIds.includes(team.id) ? '✓' : '+'}
                  </Text>
                </TouchableOpacity>
              ))}
              {searchResults.length === 0 && (
                <Text style={{ color: '#888', textAlign: 'center', marginTop: 20, fontSize: 16 }}>No matching items found</Text>
              )}
            </View>
          ) : (
            <>
              {/* Dynamic Cards Mode Sections */}
              {isCards && (
                <View style={styles.leagueSection}>
                  <TouchableOpacity style={styles.leagueHeaderContainer} onPress={() => toggleLeague('Essentials')}>
                    <Text style={styles.leagueHeader}>⏰ CLOCK & SHABBOS CARDS</Text>
                    <Text style={styles.leagueChevron}>{expandedLeagues['Essentials'] ? '▼' : '▶'}</Text>
                  </TouchableOpacity>
                  {expandedLeagues['Essentials'] && (
                    AVAILABLE_ESSENTIAL_CARDS.map(card => {
                      const isSelected = selectedIds.includes(card.id);
                      return (
                        <TouchableOpacity 
                          key={card.id} 
                          style={[styles.settingsItem, isSelected && styles.settingsItemSelected]}
                          onPress={() => toggleTeam(card)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.settingsItemText}>{card.name}</Text>
                            {card.description && <Text style={styles.settingsItemSubtext}>{card.description}</Text>}
                          </View>
                          <Text style={{ fontSize: 18, color: isSelected ? '#0A84FF' : '#666', fontWeight: 'bold' }}>
                            {isSelected ? '✓' : '+'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              )}

              {isCards && (
                <View style={styles.leagueSection}>
                  <TouchableOpacity style={styles.leagueHeaderContainer} onPress={() => toggleLeague('Standings')}>
                    <Text style={styles.leagueHeader}>📊 DIVISION STANDINGS</Text>
                    <Text style={styles.leagueChevron}>{expandedLeagues['Standings'] ? '▼' : '▶'}</Text>
                  </TouchableOpacity>
                  {expandedLeagues['Standings'] && (
                    AVAILABLE_STANDINGS.map(st => {
                      const isSelected = selectedIds.includes(st.id);
                      return (
                        <TouchableOpacity 
                          key={st.id} 
                          style={[styles.settingsItem, isSelected && styles.settingsItemSelected]}
                          onPress={() => toggleTeam(st)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.settingsItemText}>{st.name}</Text>
                            <Text style={styles.settingsItemSubtext}>{formatLeagueName(st.targetLeague)} • {st.divisionName}</Text>
                          </View>
                          <Text style={{ fontSize: 18, color: isSelected ? '#0A84FF' : '#666', fontWeight: 'bold' }}>
                            {isSelected ? '✓' : '+'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>
              )}

              {/* Standard Leagues */}
              {leagues.map(league => (
                <View key={league} style={styles.leagueSection}>
                  <TouchableOpacity style={styles.leagueHeaderContainer} onPress={() => toggleLeague(league)}>
                    <Text style={styles.leagueHeader}>{league}</Text>
                    <Text style={styles.leagueChevron}>{expandedLeagues[league] ? '▼' : '▶'}</Text>
                  </TouchableOpacity>
                  {expandedLeagues[league] && setupItems.filter(t => formatLeagueName(t.league) === league).map(team => (
                    <TouchableOpacity 
                      key={team.id} 
                      style={[styles.settingsItem, selectedIds.includes(team.id) && styles.settingsItemSelected]}
                      onPress={() => toggleTeam(team)}
                    >
                      <Text style={styles.settingsItemText}>{team.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </>
          )}

          <View style={styles.leagueSection}>
            <TouchableOpacity style={styles.leagueHeaderContainer} onPress={() => toggleLeague('Free Text')}>
              <Text style={styles.leagueHeader}>FREE TEXT (RSS)</Text>
              <Text style={styles.leagueChevron}>{expandedLeagues['Free Text'] ? '▼' : '▶'}</Text>
            </TouchableOpacity>
            {expandedLeagues['Free Text'] && (
              <View style={{ paddingHorizontal: 15, gap: 15, paddingBottom: 10 }}>
                <Text style={styles.settingsItemSubtext}>Add a custom RSS feed from your blog or another source.</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Feed Name (e.g., My Blog)"
                  placeholderTextColor="#888"
                  value={customRssName}
                  onChangeText={setCustomRssName}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="https://example.com/feed.xml"
                  placeholderTextColor="#888"
                  value={customRssUrl}
                  onChangeText={setCustomRssUrl}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <TouchableOpacity style={[styles.primaryButtonSettings, { marginBottom: 0, opacity: (customRssName && customRssUrl) ? 1 : 0.5 }]} onPress={addCustomFeed} disabled={!customRssName || !customRssUrl}>
                  <Text style={styles.primaryButtonText}>Add Custom Feed</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {isTablet && !isCards && (
            <View style={styles.leagueSection}>
              <TouchableOpacity style={styles.leagueHeaderContainer} onPress={() => toggleLeague('Zmanim')}>
                <Text style={styles.leagueHeader}>ZMANIM DISPLAY (TABLET)</Text>
                <Text style={styles.leagueChevron}>{expandedLeagues['Zmanim'] ? '▼' : '▶'}</Text>
              </TouchableOpacity>
              {expandedLeagues['Zmanim'] && (
                <View style={{ paddingHorizontal: 15, gap: 10, paddingBottom: 10 }}>
                  <TouchableOpacity style={[styles.settingsItem, zmanimLayout === 'standard' && styles.settingsItemSelected]} onPress={() => setZmanimLayout('standard')}>
                    <View>
                      <Text style={styles.settingsItemText}>Standard</Text>
                      <Text style={styles.settingsItemSubtext}>Show in News & Weather cards</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.settingsItem, zmanimLayout === 'always-on' && styles.settingsItemSelected]} onPress={() => setZmanimLayout('always-on')}>
                    <View>
                      <Text style={styles.settingsItemText}>Always On</Text>
                      <Text style={styles.settingsItemSubtext}>Show in a persistent footer bar</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>
        <TouchableOpacity style={styles.primaryButtonSettings} onPress={handleSave}>
          <Text style={styles.primaryButtonText}>Save & Launch Ticker</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondaryButtonSettings, {marginTop: 0, opacity: isSavingRemote ? 0.6 : 1}]}
          onPress={openRemoteSetup}
          disabled={isSavingRemote}
        >
          <Text style={styles.secondaryButtonText}>🔗 Remote Setup</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function WelcomeScreen({ onLaunch, onSetup }) {
  const [showCredits, setShowCredits] = useState(false);

  if (showCredits) {
    return (
      <SafeAreaView style={styles.settingsWrapper}>
        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingVertical: 20 }} style={{ width: '100%', maxWidth: 600 }}>
          <Text style={styles.settingsHeader}>Credits & Attribution</Text>
          <Text style={styles.creditsText}>
            This application uses data and images from various third-party sources. We are not affiliated with, endorsed by, or sponsored by any of these entities.{"\n\n"}
            • Sports Data & Logos: ESPN API{"\n"}
            • PWHL Data: HockeyTech / The PWHL{"\n"}
            • Weather: Open-Meteo API{"\n"}
            • Jewish Calendar & Zmanim: Hebcal{"\n"}
            • Sunrise/Sunset Calculations: Sunrise-Sunset.org{"\n"}
            • News Feeds: The respective news organizations via public RSS feeds.{"\n\n"}
            All trademarks, logos, and brand names are the property of their respective owners.
          </Text>
          <TouchableOpacity style={styles.primaryButtonSettings} onPress={() => setShowCredits(false)}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const rawVer = Constants.manifest?.version || Constants.expoConfig?.version || '4.0.1';
  const displayVer = rawVer.startsWith('v') || rawVer.startsWith('BETA') ? rawVer : `v${rawVer}`;

  return (
    <SafeAreaView style={styles.settingsWrapper}>
      <View style={styles.welcomeContainer}>
        <Text style={styles.welcomeTitle}>Shabbos Mode Ticker</Text>
        <TouchableOpacity style={styles.primaryButtonSettings} onPress={onLaunch}>
          <Text style={styles.primaryButtonText}>Launch Ticker</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButtonSettings} onPress={onSetup}>
          <Text style={styles.secondaryButtonText}>Setup Ticker</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.secondaryButtonSettings, { marginTop: 10, borderColor: 'transparent' }]} onPress={() => setShowCredits(true)}>
          <Text style={[styles.secondaryButtonText, { fontSize: 14, opacity: 0.7 }]}>Credits & Legal</Text>
        </TouchableOpacity>
        <Text style={styles.versionText}>{displayVer}</Text>
      </View>
    </SafeAreaView>
  );
}

function RemoteSetupScreen({ visible, onClose }) {
  const [deviceId, setDeviceId] = useState(null);
  const YOUR_WEBSITE_URL = "https://adambrress.github.io/Adambrress/remote-setup.html"; // <-- IMPORTANT: Change this

  useEffect(() => {
    const getDeviceId = async () => {
      let id = await AsyncStorage.getItem('device_uuid');
      if (!id) {
        id = uuidv4();
        await AsyncStorage.setItem('device_uuid', id);
      }
      setDeviceId(id);
    };
    if (visible) {
      getDeviceId();
    }
  }, [visible]);

  const remoteUrl = `${YOUR_WEBSITE_URL}?id=${deviceId}`;

  return (
    <Modal
      animationType="slide"
      transparent={false}
      visible={visible}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.settingsWrapper}>
        <View style={styles.welcomeContainer}>
          <Text style={styles.settingsHeader}>Remote Setup</Text>
          <Text style={styles.creditsText}>
            Scan this QR code with another device (like your phone) to open a webpage where you can change the selected teams remotely.{"\n"}
            If you make changes on this device, you will need to rescan the QR code to see those changes reflected on the device you scan the QR code with.
          </Text>
          <View style={styles.qrCodeContainer}>
            {deviceId ? (
              <QRCode
                value={remoteUrl}
                size={250}
                backgroundColor="white"
                color="black"
              />
            ) : (
              <ActivityIndicator size="large" color="#0A84FF" />
            )}
          </View>
          <TouchableOpacity style={styles.primaryButtonSettings} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('welcome'); // 'welcome', 'format_select', 'settings', 'ticker'
  const [preferences, setPreferences] = useState({
    format: 'classic',
    teams: ALL_AVAILABLE_ITEMS.filter(t => t.id === 'weather-local'),
    lastUpdated: Date.now(),
    zmanimLayout: 'standard',
  });
  const [isReady, setIsReady] = useState(false);
  const [deviceId, setDeviceId] = useState(null);
  const isInitialFirebaseLoad = useRef(true);
  const preferencesRef = useRef({ format: 'classic', teams: [], lastUpdated: 0, zmanimLayout: 'standard' });

  const lockLandscapeOrientation = async (context = '') => {
    const lockAsyncWithTimeout = async (orientation) => {
      const lockPromise = ScreenOrientation.lockAsync(orientation);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('lock timeout')), 5000));
      return Promise.race([lockPromise, timeoutPromise]);
    };

    console.log('[Orientation] lockLandscapeOrientation', { context, currentScreen });
    try {
      await lockAsyncWithTimeout(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
      console.log('[Orientation] locked LANDSCAPE_RIGHT', { context });
    } catch (error) {
      console.warn('[Orientation] LANDSCAPE_RIGHT failed', { context, error });
      try {
        await lockAsyncWithTimeout(ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
        console.log('[Orientation] locked LANDSCAPE_LEFT', { context });
      } catch (fallbackError) {
        console.warn('[Orientation] landscape lock failed:', { context, fallbackError });
      }
    }
  };

  useEffect(() => {
    const applyOrientation = async () => {
      try {
        if (currentScreen === 'ticker') {
          await lockLandscapeOrientation();
        } else {
          await ScreenOrientation.unlockAsync();
        }
      } catch (error) {
        console.warn('[Orientation] change failed:', error);
      }
    };

    const handleAppStateChange = (nextAppState) => {
      if (nextAppState === 'active') {
        applyOrientation();
      }
    };

    applyOrientation();
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
      if (currentScreen === 'ticker') {
        ScreenOrientation.unlockAsync().catch(() => {});
      }
    };
  }, [currentScreen]);

  useEffect(() => {
    const loadPrefs = async () => {
      console.log('[App] loadPrefs start');
      try {
        // 1. Load saved preferences from AsyncStorage
        const saved = await AsyncStorage.getItem('ticker_preferences');
        console.log('[App] loadPrefs saved raw value present', { hasSaved: saved !== null });
        if (saved !== null) {
          let parsed = JSON.parse(saved);
          let loadedTeams = [];
          if (Array.isArray(parsed.teams)) {
            // Handle both old format (array of IDs) and new format (array of objects)
            loadedTeams = parsed.teams.map(item => {
              if (typeof item === 'string') {
                return ALL_AVAILABLE_ITEMS.find(t => t.id === item);
              }
              return item; // It's already an object
            }).filter(Boolean);
          }

          const loadedPrefs = sanitizePreferences({
            format: parsed.format || 'classic',
            teams: loadedTeams,
            zmanimLayout: parsed.zmanimLayout || 'standard',
            lastUpdated: parsed.lastUpdated || Date.now()
          });
          console.log('[App] loadPrefs loadedPrefs', { loadedCount: loadedPrefs.teams.length, loadedPrefs });
          if (loadedPrefs.teams.length > 0) {
            setPreferences(prev => ({ ...prev, ...loadedPrefs }));
            preferencesRef.current = loadedPrefs;
          }
        }

        // 2. Get or create a unique device ID
        let id = await AsyncStorage.getItem('device_uuid');
        if (!id) {
          id = uuidv4();
          await AsyncStorage.setItem('device_uuid', id);
          console.log('[App] created new device_uuid', id);
        } else {
          console.log('[App] loaded device_uuid', id);
        }
        setDeviceId(id);

      } catch (e) {
        console.warn('[App] loadPrefs error', e);
        // In case of error, ensure a deviceId is still set
        const existingId = await AsyncStorage.getItem('device_uuid');
        if (!existingId) {
          const id = uuidv4();
          await AsyncStorage.setItem('device_uuid', id);
          setDeviceId(id);
          console.log('[App] fallback created device_uuid', id);
        }
      } finally {
        setIsReady(true);
        console.log('[App] loadPrefs complete, isReady=true');
      }
    };
    loadPrefs();
  }, []);

  const handleSaveSettings = useCallback(async (newPrefs, switchScreen = true, forceLaunch = false) => {
    const updatedPrefs = sanitizePreferences({
      ...preferencesRef.current,
      ...newPrefs,
      lastUpdated: Date.now() // Always update the timestamp on save
    });
    console.log('[App] handleSaveSettings', { switchScreen, forceLaunch, teamCount: updatedPrefs.teams.length });
    setPreferences(updatedPrefs);
    preferencesRef.current = updatedPrefs;
    try {
      const payloadToSave = {
          format: updatedPrefs.format,
          teams: updatedPrefs.teams, // Save the full objects
          zmanimLayout: updatedPrefs.zmanimLayout || 'standard',
          lastUpdated: updatedPrefs.lastUpdated
      };
      await AsyncStorage.setItem('ticker_preferences', JSON.stringify(payloadToSave));
      console.log('[App] handleSaveSettings saved local preferences', payloadToSave);
      if (deviceId) {
        const dbRef = ref(database, `devices/${deviceId}/preferences`);
        await set(dbRef, payloadToSave);
        console.log('[App] handleSaveSettings saved remote preferences', deviceId);
      }
    } catch (e) {
      console.warn('[App] handleSaveSettings save error', e);
    }
    if (switchScreen || forceLaunch) {
      console.log('[App] handleSaveSettings switching to ticker');
      setCurrentScreen('ticker');
    }
  }, [deviceId, setCurrentScreen]);

  // Firebase listener for remote preference changes
  useEffect(() => {
    if (!deviceId) return;

    const dbRef = ref(database, `devices/${deviceId}/preferences`);
    const unsubscribe = onValue(dbRef, (snapshot) => {
      const remoteData = snapshot.val();
      console.log('[App] remote prefs change', { remoteData, currentLocalLastUpdated: preferencesRef.current.lastUpdated });
      if (remoteData && remoteData.lastUpdated > preferencesRef.current.lastUpdated) {
        let remoteTeams = [];
        if (Array.isArray(remoteData.teams)) {
          remoteTeams = remoteData.teams.map(item => {
            if (typeof item === 'string') return ALL_AVAILABLE_ITEMS.find(t => t.id === item);
            return item;
          }).filter(Boolean);
        }
        const newPrefs = sanitizePreferences({ 
          format: remoteData.format || preferencesRef.current.format || 'classic',
          teams: remoteTeams,
          zmanimLayout: remoteData.zmanimLayout || preferencesRef.current.zmanimLayout,
          lastUpdated: remoteData.lastUpdated
        });

        if (isInitialFirebaseLoad.current) {
          console.log('Initial Firebase prefs loaded, not auto-launching.');
          handleSaveSettings(newPrefs, false, false); // Just save, don't switch screen
          isInitialFirebaseLoad.current = false;
        } else {
          console.log('Remote preferences updated, auto-launching ticker.');
          setPreferences(newPrefs);
          preferencesRef.current = newPrefs;
          const payloadToSave = { format: newPrefs.format, teams: newPrefs.teams, zmanimLayout: newPrefs.zmanimLayout, lastUpdated: newPrefs.lastUpdated };
          AsyncStorage.setItem('ticker_preferences', JSON.stringify(payloadToSave)).catch(() => {});
          setCurrentScreen('ticker');
        }
      }
    });

    return () => unsubscribe();
  }, [deviceId, handleSaveSettings]);

  if (!isReady) {
    return (
      <SafeAreaProvider style={{ backgroundColor: '#000000' }}>
        <SafeAreaView style={styles.wrapper}>
          <ActivityIndicator size="large" color="#0A84FF" />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider style={{ backgroundColor: '#000000' }}>
      {currentScreen === 'welcome' && (
        <WelcomeScreen 
          onLaunch={() => setCurrentScreen('ticker')} 
          onSetup={() => setCurrentScreen('format_select')} 
        />
      )}
      {currentScreen === 'format_select' && (
        <FormatSelectScreen 
          currentFormat={preferences.format || 'classic'}
          onSelectFormat={(chosenFormat) => {
            setPreferences(prev => sanitizePreferences({ ...prev, format: chosenFormat }));
            preferencesRef.current = sanitizePreferences({ ...preferencesRef.current, format: chosenFormat });
            setCurrentScreen('settings');
          }}
          onBack={() => setCurrentScreen('welcome')}
        />
      )}
      {currentScreen === 'settings' && (
        <SettingsScreen 
          currentPreferences={preferences} 
          onSave={handleSaveSettings}
          onChangeFormat={() => setCurrentScreen('format_select')}
        />
      )}
      {currentScreen === 'ticker' && (
        <TickerApp 
          preferences={preferences} 
          onSetup={() => setCurrentScreen('format_select')} 
        />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 30,
    textAlign: 'center',
  },
  loadingBarContainer: {
    width: '60%',
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  loadingBarFill: {
    height: '100%',
    backgroundColor: '#0A84FF',
  },
  loadingPercent: {
    color: '#EBEBF5',
    fontSize: 18,
    marginTop: 15,
    fontWeight: '600',
  },
  wrapper: { 
    flex: 1, 
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
    marginBottom: 15,
  },
  timeText: {
    color: '#ffffff',
    fontSize: 48,
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
  havdalahClockText: {
    color: '#EBEBF5',
    opacity: 0.7,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'left',
    marginBottom: 4,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: '90%',
    marginBottom: 15,
  },
  infoContainer: {
    gap: 15,
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
    marginBottom: 4,
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
  logoWinner: {
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 8,
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
  teamRank: {
    fontSize: 12,
    fontWeight: '400',
    color: '#EBEBF5',
    opacity: 0.7,
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
  weatherCard: {
    backgroundColor: '#1E1E24',
    padding: 26,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 12,
  },
  weatherHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  weatherTitleGroup: {
    flex: 1,
  },
  weatherLocation: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  weatherCondition: {
    color: '#DDE4FF',
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.95,
  },
  weatherIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  weatherEmoji: {
    fontSize: 30,
  },
  weatherMain: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  weatherTemp: {
    color: '#FFFFFF',
    fontSize: 84,
    fontWeight: '900',
    lineHeight: 88,
  },
  weatherDetails: {
    alignItems: 'flex-end',
  },
  weatherConditionLarge: {
    color: '#F5F7FF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 10,
    textTransform: 'capitalize',
  },
  weatherHighLowRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 8,
  },
  weatherHiLo: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  forecastRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  forecastItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  forecastTime: {
    color: '#E7F0FF',
    fontSize: 12,
    marginBottom: 8,
  },
  forecastIcon: {
    fontSize: 18,
    marginBottom: 8,
  },
  forecastTemp: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  forecastPop: {
    color: '#B8D2FF',
    fontSize: 12,
  },
  draftContainer: {
    paddingVertical: 5,
    gap: 8,
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    padding: 12,
    borderRadius: 12,
  },
  draftPickNum: {
    color: '#EBEBF5',
    fontSize: 20,
    fontWeight: '800',
    width: 45,
  },
  draftTeamLogo: {
    width: 36,
    height: 36,
    marginRight: 15,
  },
  draftPlayerInfo: {
    flex: 1,
  },
  draftPlayerName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  draftPlayerDetails: {
    color: '#EBEBF5',
    opacity: 0.8,
    fontSize: 14,
    marginTop: 2,
  },
  draftTradeText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '600',
  },
  scoreboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    gap: 8,
    marginTop: 5,
    paddingBottom: 15
  },
  scoreboardCell: {
    width: '32%',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  scoreboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6
  },
  scoreLogo: {
    width: 24,
    height: 24,
    marginRight: 8
  },
  scoreAbbr: {
    color: '#EBEBF5',
    fontSize: 16,
    fontWeight: '700',
    flex: 1
  },
  scoreRank: {
    fontSize: 10,
    fontWeight: '400',
    color: 'rgba(235, 235, 245, 0.65)',
  },
  scorePts: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800'
  },
  scoreWinner: {
    color: '#FFD700'
  },
  scoreStatus: {
    color: '#A0A0A5',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    textTransform: 'uppercase'
  },
  newsHeadline: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 34
  },
  rssCard: {
    backgroundColor: '#2c2c2e',
    justifyContent: 'space-between',
    minHeight: 220,
  },
  rssContentContainer: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rssTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    lineHeight: 28,
    marginBottom: 10,
    textAlign: 'left',
  },
  rssTitleTablet: {
    fontSize: 32,
    lineHeight: 40,
    marginBottom: 14,
  },
  rssTitleCont: {
    color: 'rgba(235, 235, 245, 0.7)',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 10,
    textAlign: 'left',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rssTitleContTablet: {
    fontSize: 26,
    lineHeight: 26,
    marginBottom: 12,
  },
  rssBodyContainer: {
    gap: 8,
  },
  rssBodyParagraph: {
    color: '#EBEBF5',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  rssBodyParagraphTablet: {
    fontSize: 18,
    lineHeight: 26,
  },
  rssPageBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  rssPageText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  qrCodeContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    marginBottom: 30,
    justifyContent: 'center',
    alignItems: 'center'
  },
  progressBar: {
    height: 4,
    position: 'absolute',
    bottom: 0,
    left: 0,
    zIndex: 10,
  },
  primaryButtonSettings: {
    backgroundColor: '#0A84FF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 15,
    width: '100%',
    maxWidth: 600
  },
  searchInput: {
    backgroundColor: '#1C1C1E',
    color: '#FFF',
    width: '100%',
    maxWidth: 600,
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    fontSize: 16,
  },
  textInput: {
    backgroundColor: '#2C2C2E',
    color: '#FFF',
    padding: 12,
    borderRadius: 8,
    minHeight: 60,
    textAlignVertical: 'top'
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold'
  },
  chip: {
    backgroundColor: '#0A84FF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center'
  },
  chipText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600'
  },
  dropdown: {
    backgroundColor: '#3A3A3C',
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 15,
    maxHeight: 180,
    width: '100%',
  },
  dropdownItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)'
  },
  dropdownItemText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500'
  },
  settingsWrapper: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
    alignItems: 'center'
  },
  settingsHeader: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
    marginTop: 20
  },
  settingsList: {
    width: '100%',
    maxWidth: 600,
    marginBottom: 20
  },
  leagueSection: {
    marginBottom: 20,
  },
  leagueHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  leagueHeader: {
    color: '#0A84FF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  leagueChevron: {
    color: '#0A84FF',
    fontSize: 16,
  },
  clearAllText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: 'bold',
  },
  removeButton: {
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  removeButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: 'bold',
  },
  selectedTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 15,
    marginBottom: 10,
  },
  selectedTag: {
    backgroundColor: '#0A84FF',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedTagText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  settingsItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 10,
    marginLeft: 15,
    marginRight: 15
  },
  settingsItemSelected: {
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    borderColor: '#0A84FF',
  },
  settingsItemText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600'
  },
  settingsItemSubtext: {
    color: '#EBEBF5',
    opacity: 0.7,
    fontSize: 14,
    marginTop: 4,
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
  },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 40,
    textAlign: 'center'
  },
  versionText: {
    color: '#EBEBF5',
    opacity: 0.5,
    fontSize: 12,
    marginTop: 20,
    textAlign: 'center',
  },
  creditsText: {
    color: '#EBEBF5',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 40,
    opacity: 0.9,
  },
  secondaryButtonSettings: {
    backgroundColor: 'transparent',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 15,
    width: '100%',
    borderWidth: 1,
    borderColor: '#0A84FF'
  },
  secondaryButtonText: {
    color: '#0A84FF',
    fontSize: 16,
    fontWeight: 'bold'
  },
  cycleIndicatorWrapper: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  cycleIndicatorContainer: {
    flexDirection: 'row',
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20
  },
  cycleIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.5
  },
  cycleIconWrapperActive: {
    opacity: 1,
    backgroundColor: 'rgba(255,255,255,0.35)',
    transform: [{ scale: 1.25 }]
  },
  cycleIconImage: {
    width: 20,
    height: 20
  },
  cycleIconText: {
    fontSize: 16
  },
  runnerUpContainer: {
    marginTop: 15,
    width: '100%',
    backgroundColor: 'rgba(21, 35, 75, 0.5)',
    borderRadius: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  runnerUpHeader: {
    color: '#EBEBF5',
    opacity: 0.7,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  runnerUpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  runnerUpName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    flex: 0.35,
  },
  runnerUpStats: {
    color: '#EBEBF5',
    flexShrink: 1,
    flex: 1,
    marginLeft: 8,
    opacity: 0.9,
    fontSize: 15,
    fontWeight: '500',
    flex: 0.5,
    textAlign: 'center',
  },
  runnerUpScore: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: '700',
    flex: 0.15,
    textAlign: 'right',
  },
  zmanimFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 40,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 20,
  },
  floatingSetupButton: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    backgroundColor: 'rgba(44, 44, 46, 0.9)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    zIndex: 100,
    borderWidth: 1,
    borderColor: '#0A84FF',
  },
  floatingSetupButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  zmanimFooterText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    opacity: 0.9,
  },

  // --- Format Switcher Banner ---
  formatBanner: {
    width: '100%',
    maxWidth: 600,
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2C2C2E',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  formatBannerInfo: {
    flex: 1,
    minWidth: 140,
  },
  formatBannerLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  formatBannerValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  formatBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  formatToggleTab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#2C2C2E',
  },
  formatToggleTabActive: {
    backgroundColor: '#0A84FF',
  },
  formatToggleTabText: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '600',
  },
  formatToggleTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  formatDetailBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  formatDetailBtnText: {
    color: '#0A84FF',
    fontSize: 13,
    fontWeight: '600',
  },

  // --- Format Selection Screen ---
  formatSelectHeader: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  formatSelectSubheader: {
    color: '#8E8E93',
    fontSize: 16,
    marginBottom: 28,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  formatCardsContainer: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 30,
  },
  formatCard: {
    flex: 1,
    minWidth: 280,
    maxWidth: 350,
    backgroundColor: '#1C1C1E',
    borderRadius: 18,
    padding: 22,
    borderWidth: 2,
    borderColor: '#2C2C2E',
    justifyContent: 'space-between',
  },
  formatCardActive: {
    borderColor: '#0A84FF',
    backgroundColor: '#182438',
  },
  formatBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#3A3A3C',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  formatBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  formatCardTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  formatCardDescription: {
    color: '#C7C7CC',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  formatPreviewBox: {
    height: 90,
    backgroundColor: '#000000',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3A3A3C',
    overflow: 'hidden',
    flexDirection: 'row',
    marginBottom: 18,
    padding: 6,
    gap: 6,
  },
  formatPreviewLeft: {
    width: '38%',
    backgroundColor: '#1C1C1E',
    borderRadius: 6,
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewMiniClock: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  previewMiniSub: {
    color: '#8E8E93',
    fontSize: 8,
    marginTop: 2,
  },
  formatPreviewRight: {
    flex: 1,
    backgroundColor: '#15234B',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
  },
  previewMiniCard: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  formatPreviewFull: {
    flex: 1,
    backgroundColor: '#1A2A4A',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  previewMiniCardFull: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 16,
  },
  formatSelectRadio: {
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
  },
  formatSelectRadioActive: {
    backgroundColor: '#0A84FF',
  },
  formatSelectRadioText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // --- Clock Card ---
  clockCardFull: {
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clockCardContent: {
    width: '100%',
    alignItems: 'center',
  },
  clockCardTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  clockLocationBadge: {
    color: '#8E8E93',
    fontSize: 15,
    fontWeight: '600',
  },
  clockSunsetBadge: {
    color: '#FF9500',
    fontSize: 15,
    fontWeight: '600',
  },
  clockBigDisplay: {
    marginVertical: 10,
    alignItems: 'center',
  },
  clockBigTime: {
    color: '#FFFFFF',
    fontSize: 84,
    fontWeight: '900',
    letterSpacing: -1,
  },
  clockAmPm: {
    color: '#0A84FF',
    fontSize: 32,
    fontWeight: '700',
  },
  clockBigDate: {
    color: '#EBEBF5',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 16,
  },
  clockDivider: {
    width: '60%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 12,
  },
  clockHebrewContainer: {
    alignItems: 'center',
  },
  clockHebrewLabel: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  clockHebrewDate: {
    color: '#FFD700',
    fontSize: 24,
    fontWeight: '800',
  },

  // --- Zmanim Card ---
  zmanimCardFull: {
    backgroundColor: '#141E30',
    padding: 24,
  },
  zmanimSpotlightRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 20,
  },
  zmanimSpotlightBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  zmanimSpotlightIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  zmanimSpotlightLabel: {
    color: '#EBEBF5',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  zmanimSpotlightTime: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
  },
  zmanimSpotlightSubtext: {
    color: '#C7C7CC',
    fontSize: 13,
    marginTop: 4,
    fontWeight: '500',
  },
  zmanimGridContainer: {
    width: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    padding: 14,
  },
  zmanimGridHeader: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
    textAlign: 'center',
  },
  zmanimGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  zmanimGridItem: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  zmanimItemLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  zmanimItemTime: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  // --- Standings Card ---
  standingsCardFull: {
    backgroundColor: '#111827',
    padding: 20,
  },
  standingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  standingsHeaderLogo: {
    width: 32,
    height: 32,
  },
  standingsTableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
    marginBottom: 4,
  },
  stHeaderCol: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  standingsRowsContainer: {
    width: '100%',
  },
  standingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
  },
  standingsRowLeader: {
    backgroundColor: 'rgba(255, 215, 0, 0.08)',
    borderRadius: 6,
  },
  stCellRank: {
    width: 35,
    textAlign: 'center',
    color: '#8E8E93',
    fontSize: 14,
    fontWeight: '700',
  },
  stCellTeam: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    gap: 8,
  },
  stTeamLogo: {
    width: 24,
    height: 24,
  },
  stTeamName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  stCellStat: {
    width: 50,
    textAlign: 'right',
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  // --- Parsha Card ---
  parshaCardFull: {
    padding: 24,
    justifyContent: 'center',
  },
  parshaCenterContent: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  parshaShabbatGreeting: {
    color: '#FFD700',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 8,
  },
  parshaHebrewName: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    marginBottom: 6,
  },
  parshaEnglishName: {
    color: '#64D2FF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  haftarahContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
    maxWidth: 500,
  },
  haftarahLabel: {
    color: '#8E8E93',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 2,
  },
  haftarahText: {
    color: '#EBEBF5',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  parshaCandleBadge: {
    backgroundColor: 'rgba(255, 165, 0, 0.2)',
    borderColor: '#FFA500',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  parshaCandleText: {
    color: '#FFD700',
    fontSize: 15,
    fontWeight: '700',
  }
});