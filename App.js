import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

/* Safe notifications loader (Expo Go skips, APK gets real notifications) */
let Notifications = null;
try {
  Notifications = require('expo-notifications');
  if (Notifications && Notifications.setNotificationHandler) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }
} catch (e) {
  Notifications = null;
}

let permissionsAsked = false;
async function sendSystemNotification(title, body) {
  if (!Notifications) return;
  try {
    if (!permissionsAsked) {
      permissionsAsked = true;
      await Notifications.requestPermissionsAsync();
    }
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null });
  } catch (e) {}
}

const CONFIG = {
  collegeName: 'Ethiraj College for Women',
  appName: 'ECWian',
  portals: [
    'https://coe.ethirajcollege.in/student/',
    'http://coe.ethirajcollege.in/student/',
  ],
  defaultRequiredAttendance: 75,
};

const STORAGE_KEYS = {
  data: '@att_subjects',
  syncedAt: '@att_synced_at',
  theme: '@att_theme',
  overrides: '@att_name_overrides',
  exams: '@att_exams',
};

const EXAM_TYPES = [
  { key: 'CA1', icon: '📘', label: 'CA 1', desc: 'Continuous Assessment 1' },
  { key: 'CA2', icon: '📗', label: 'CA 2', desc: 'Continuous Assessment 2' },
  { key: 'SEMESTER', icon: '🎓', label: 'Semester', desc: 'End Semester Exams' },
];

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */
const THEMES = {
  light: {
    bg: '#f8fafc', card: '#ffffff', border: '#e2e8f0', panel: '#f8fafc',
    text: '#0f172a', subtext: '#64748b', muted: '#94a3b8',
    accent: '#2563eb', good: '#15803d', bad: '#dc2626', warn: '#d97706', info: '#0369a1',
    chipGood: '#dcfce7', chipWarn: '#fef3c7', chipInfo: '#e0f2fe', chipBad: '#fee2e2', chipNeutral: '#f1f5f9',
    adviceBg: '#eff6ff', adviceBorder: '#bfdbfe', adviceText: '#1d4ed8',
    overlayDim: 'rgba(15,23,42,0.45)', track: '#e2e8f0', closeBg: '#0f172a',
  },
  dark: {
    bg: '#0b1220', card: '#121c30', border: '#1f2a44', panel: '#0f172a',
    text: '#e5eefc', subtext: '#9fb0ca', muted: '#64748b',
    accent: '#3b82f6', good: '#4ade80', bad: '#f87171', warn: '#fbbf24', info: '#38bdf8',
    chipGood: 'rgba(74,222,128,0.15)', chipWarn: 'rgba(251,191,36,0.15)', chipInfo: 'rgba(56,189,248,0.15)',
    chipBad: 'rgba(248,113,113,0.15)', chipNeutral: 'rgba(148,163,184,0.15)',
    adviceBg: 'rgba(59,130,246,0.12)', adviceBorder: 'rgba(59,130,246,0.35)', adviceText: '#93c5fd',
    overlayDim: 'rgba(0,0,0,0.6)', track: '#1f2a44', closeBg: '#1e293b',
  },
};

const ThemeContext = React.createContext(null);
function useTheme() { return React.useContext(ThemeContext); }

/* ------------------------------------------------------------------ */
/* Hidden-browser scripts                                              */
/* ------------------------------------------------------------------ */
const CHECK_JS = `
(function(){
  if (window.__attCheckRan) return;
  window.__attCheckRan = true;
  function send(o){ if(window.ReactNativeWebView && window.ReactNativeWebView.postMessage) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  if (document.querySelector('input[type=password]')) { send({type:'LOGIN_PAGE'}); return; }

  function fetchJson(url, body){
    return fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
      body: body || '',
      credentials:'include'
    }).then(function(r){ return r.text(); }).then(function(t){
      try { return JSON.parse(t); } catch(e){ return null; }
    }).catch(function(){ return null; });
  }

  fetchJson('/student/attendance/list', 'task=LISTING').then(function(data){
    if (!data || !data.attends || !data.attends.length) { send({type:'LOGIN_PAGE'}); return; }

    fetchJson('/student/upcomingexams/list', '').catch(function(){ return null; }).then(function(ex){
      return fetchJson('/student/assignment/list', 'task=LISTING').catch(function(){ return null; }).then(function(as){
        var names = {};
        if (as && as.assigns) as.assigns.forEach(function(a){
          if (a.subject_id && a.subject_name) names[a.subject_id] = a.subject_name;
        });
        if (ex && ex.upcomingexams) ex.upcomingexams.forEach(function(e){
          if (e.subject_code && e.subject_name) names[e.subject_code] = e.subject_name;
        });

        send({
          type:'ATTENDANCE_CAPTURED',
          subjects: data.attends.map(function(item, index){
            var code = item.sub_code || String(index);
            return {
              id: code,
              code: code,
              name: names[code] || code,
              attended: Number(item.present_hours)||0,
              total: Number(item.total_hours)||0,
              absent: Number(item.absent_hours)||0,
              percentage: Number(item.percentage)||0,
              requiredPercentage: 75
            };
          })
        });
      });
    });
  });
})();
true;
`;

/* Login ghost v4: four strategies, verify after each, forensics on failure.
   1) direct POST of ALL form fields (incl. hidden tokens)
   2) ExtJS component setValue + fire their Login button handler
   3) native form.submit()
   4) plain button click
   After each: probe attendance; first success wins. Failure embeds [DBG] forensics. */
function buildLoginJs(userid, password) {
  const u = JSON.stringify(userid);
  const p = JSON.stringify(password);
  return `
(function(){
  function send(o){ if(window.ReactNativeWebView && window.ReactNativeWebView.postMessage) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  var diag = { url: location.href, ext: !!window.Ext, form: null, inputs: [], strats: [] };

  function fetchJson(url, body){
    return fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest'},
      body: body || '',
      credentials:'include'
    }).then(function(r){ return r.text(); }).then(function(t){
      try { return JSON.parse(t); } catch(e){ return null; }
    }).catch(function(){ return null; });
  }

  function probe(){
    return fetchJson('/student/attendance/list','task=LISTING').then(function(data){
      return (data && data.attends && data.attends.length) ? data : null;
    });
  }

  function sendCapture(data){
    fetchJson('/student/upcomingexams/list', '').catch(function(){ return null; }).then(function(ex){
      return fetchJson('/student/assignment/list', 'task=LISTING').catch(function(){ return null; }).then(function(as){
        var names = {};
        if (as && as.assigns) as.assigns.forEach(function(a){
          if (a.subject_id && a.subject_name) names[a.subject_id] = a.subject_name;
        });
        if (ex && ex.upcomingexams) ex.upcomingexams.forEach(function(e){
          if (e.subject_code && e.subject_name) names[e.subject_code] = e.subject_name;
        });
        send({
          type:'ATTENDANCE_CAPTURED',
          subjects: data.attends.map(function(item, index){
            var code = item.sub_code || String(index);
            return {
              id: code,
              code: code,
              name: names[code] || code,
              attended: Number(item.present_hours)||0,
              total: Number(item.total_hours)||0,
              absent: Number(item.absent_hours)||0,
              percentage: Number(item.percentage)||0,
              requiredPercentage: 75
            };
          })
        });
      });
    });
  }

  function setVal(el, v){
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
  }

  function serialize(scope){
    var params = new URLSearchParams();
    Array.prototype.forEach.call(scope.querySelectorAll('input,select,textarea'), function(el){
      if (!el.name) return;
      var ty = (el.type || '').toLowerCase();
      if (ty === 'checkbox' || ty === 'radio') { if (el.checked) params.set(el.name, el.value || 'on'); return; }
      params.set(el.name, el.value || '');
    });
    return params;
  }

  function doFill(){
    var inputs = Array.from(document.querySelectorAll('input'));
    diag.inputs = inputs.map(function(i){ return (i.type||'text') + ':' + (i.name || i.id || '?'); }).slice(0, 10);
    var user = inputs.find(function(i){
      var t=(i.type||'text').toLowerCase();
      var meta=((i.id||'')+' '+(i.name||'')+' '+(i.placeholder||'')).toLowerCase();
      return (t==='text'||t==='email') && /user|reg|roll|login|id/.test(meta);
    }) || inputs.find(function(i){ var t=(i.type||'text').toLowerCase(); return t==='text'||t==='email'; });
    var pass = inputs.find(function(i){ return (i.type||'').toLowerCase()==='password'; });
    if(!user||!pass){ send({type:'LOGIN_FAILED', reason:'fields', diag:diag}); return; }

    setVal(user, ${u});
    setVal(pass, ${p});
    user.value = ${u};
    pass.value = ${p};

    try {
      if (window.Ext && Ext.ComponentMgr && Ext.ComponentMgr.all) {
        Ext.ComponentMgr.all.each(function(c){
          try {
            if (c.el && c.el.dom === user && c.setValue) c.setValue(${u});
            if (c.el && c.el.dom === pass && c.setValue) c.setValue(${p});
          } catch(e){}
        });
      }
    } catch(e){}

    var form = pass.closest('form') || user.closest('form');
    diag.form = form ? String(form.action || 'form-noaction').slice(-40) : 'none';

    function nativeSubmit(){
      send({type:'LOGIN_DIAG', diag:diag});
      if (form) {
        diag.strats.push('native:y');
        try { form.submit(); return; } catch(e){ send({type:'LOGIN_FAILED', reason:'submit', diag:diag}); return; }
      }
      var btn = Array.from(document.querySelectorAll('button, input[type=submit], a')).find(function(b){
        return /login|sign in|submit/i.test((b.innerText||b.value||''));
      });
      diag.strats.push('click:' + (btn?'y':'n'));
      if (btn) btn.click(); else send({type:'LOGIN_FAILED', reason:'submit', diag:diag});
    }

    function tryExt(){
      var fired = false;
      try {
        if (window.Ext && Ext.ComponentMgr && Ext.ComponentMgr.all) {
          Ext.ComponentMgr.all.each(function(c){
            if (c.text && /login|sign in/i.test(c.text) && typeof c.fireEvent === 'function') { c.fireEvent('click', c); fired = true; }
          });
        }
      } catch(e){}
      diag.strats.push('extfire:' + (fired?'y':'n'));
      setTimeout(function(){
        probe().then(function(data){
          if (data) { diag.strats.push('extprobe:ok'); sendCapture(data); return; }
          diag.strats.push('extprobe:no');
          nativeSubmit();
        });
      }, 1200);
    }

    var scope = form || document;
    var params = serialize(scope);
    if (user.name) params.set(user.name, ${u});
    if (pass.name) params.set(pass.name, ${p});
    var url = (form && form.action) ? form.action : '/default/index/login';

    fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: params.toString(),
      credentials: 'include',
      redirect: 'follow'
    }).then(function(r){ diag.status = r.status; return r.text().catch(function(){ return ''; }); })
      .then(function(txt){ diag.resp = String(txt||'').slice(0,60).replace(/\\s+/g,' '); return probe(); })
      .then(function(data){
        if (data) { diag.strats.push('fetch:ok'); sendCapture(data); return; }
        diag.strats.push('fetch:no');
        tryExt();
      })
      .catch(function(){ diag.strats.push('fetch:err'); tryExt(); });
  }

  var tries = 0;
  var probed = false;
  function step(){
    tries++;
    if (document.querySelector('input[type=password]')) { doFill(); return; }
    if (tries >= 12) {
      diag.body = String((document.body && document.body.innerText) || '').slice(0,100).replace(/\\s+/g,' ');
      send({type:'LOGIN_FAILED', reason:'timeout', diag:diag});
      return;
    }
    if (tries === 3 && !probed) {
      probed = true;
      probe().then(function(data){
        if (data) sendCapture(data);
        else setTimeout(step, 400);
      });
      return;
    }
    setTimeout(step, 400);
  }
  step();
})();
true;
`;
}

/* ------------------------------------------------------------------ */
/* Math + date helpers                                                 */
/* ------------------------------------------------------------------ */
function getPercentage(attended, total) {
  if (!total || total <= 0) return 0;
  return (attended / total) * 100;
}
function formatPercentage(v) { return `${v.toFixed(1)}%`; }
function getSafeSkipCount(attended, total, requiredPercentage) {
  if (!total || total <= 0) return 0;
  const required = requiredPercentage / 100;
  if (required <= 0 || required >= 1) return 0;
  return Math.max(Math.floor(attended / required - total), 0);
}
function getClassesToAttend(attended, total, requiredPercentage) {
  if (!total || total <= 0) return 0;
  const required = requiredPercentage / 100;
  if (getPercentage(attended, total) >= requiredPercentage) return 0;
  if (required >= 1) return Number.POSITIVE_INFINITY;
  return Math.max(Math.ceil((required * total - attended) / (1 - required)), 0);
}
function projectAttendance(attended, total, attend = 0, skip = 0) {
  const fa = attended + attend;
  const ft = total + attend + skip;
  if (ft <= 0) return 0;
  return (fa / ft) * 100;
}
function statusInfo(subject, t) {
  const required = subject.requiredPercentage ?? CONFIG.defaultRequiredAttendance;
  const percentage = getPercentage(subject.attended, subject.total);
  if (!subject.total || subject.total <= 0) return { label: 'No Data', color: t.muted, background: t.chipNeutral };
  if (percentage < required) return { label: 'Shortage', color: t.bad, background: t.chipBad };
  const safeSkip = getSafeSkipCount(subject.attended, subject.total, required);
  if (safeSkip <= 1) return { label: 'Low Buffer', color: t.warn, background: t.chipWarn };
  if (safeSkip <= 3) return { label: 'Moderate', color: t.info, background: t.chipInfo };
  return { label: 'Safe', color: t.good, background: t.chipGood };
}

function pad(n) { return String(n).padStart(2, '0'); }
function toISODate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toHHMM(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function parseISODate(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(y, m - 1, d); }
function formatDisplayDate(iso) {
  try { return parseISODate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return iso; }
}
function formatDisplayTime(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ampm}`;
}
function daysUntil(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = parseISODate(iso); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}
function countdownLabel(iso) {
  const d = daysUntil(iso);
  if (d < 0) return 'Passed';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `in ${d} days`;
}

function computeWarnings(subjects) {
  const warnings = [];
  subjects.forEach(s => {
    if (!s.total) return;
    const required = s.requiredPercentage ?? CONFIG.defaultRequiredAttendance;
    const pct = getPercentage(s.attended, s.total);
    const name = s.displayName || s.name;
    if (pct < required) {
      const needed = getClassesToAttend(s.attended, s.total, required);
      warnings.push({ text: `${name}: ${formatPercentage(pct)} — attend next ${needed} classes` });
    } else {
      const buffer = getSafeSkipCount(s.attended, s.total, required);
      if (buffer <= 1) warnings.push({ text: `${name}: only ${buffer} class buffer left` });
    }
  });
  return warnings;
}

/* ------------------------------------------------------------------ */
/* UI pieces                                                           */
/* ------------------------------------------------------------------ */
function CreatorTag() {
  const t = useTheme();
  return (
    <Text style={[styles.creatorText, { color: t.muted }]}>~ made with ❤️ by Hisham ~</Text>
  );
}

function ProgressRing({ percentage, color, track, label, size = 72, stroke = 9 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percentage));
  const offset = c * (1 - clamped / 100);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={{ fontSize: 13, fontWeight: '900', color }}>{label}</Text>
    </View>
  );
}

function InfoRow({ label, value, valueColor }) {
  const t = useTheme();
  return (
    <View style={[styles.infoRow, { borderBottomColor: t.border }]}>
      <Text style={[styles.infoLabel, { color: t.subtext }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor || t.text }]}>{value}</Text>
    </View>
  );
}

function SummaryCard({ subjects }) {
  const totalAttended = subjects.reduce((s, i) => s + i.attended, 0);
  const totalClasses = subjects.reduce((s, i) => s + i.total, 0);
  const overall = getPercentage(totalAttended, totalClasses);
  const required = CONFIG.defaultRequiredAttendance;
  const safe = subjects.filter(s => getPercentage(s.attended, s.total) >= (s.requiredPercentage ?? required)).length;
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>Overall Attendance</Text>
      <Text style={styles.summaryPercentage}>{formatPercentage(overall)}</Text>
      <Text style={styles.summarySubtext}>Attended {totalAttended} out of {totalClasses} classes</Text>
      <View style={styles.summaryStatsRow}>
        <View style={styles.summaryStatBox}><Text style={styles.summaryStatValue}>{subjects.length}</Text><Text style={styles.summaryStatLabel}>Subjects</Text></View>
        <View style={styles.summaryStatBox}><Text style={[styles.summaryStatValue, { color: '#bbf7d0' }]}>{safe}</Text><Text style={styles.summaryStatLabel}>Safe</Text></View>
        <View style={styles.summaryStatBox}><Text style={[styles.summaryStatValue, { color: '#fecaca' }]}>{subjects.length - safe}</Text><Text style={styles.summaryStatLabel}>Shortage</Text></View>
      </View>
    </View>
  );
}

function SubjectCard({ subject, onPress }) {
  const t = useTheme();
  const required = subject.requiredPercentage ?? CONFIG.defaultRequiredAttendance;
  const percentage = getPercentage(subject.attended, subject.total);
  const status = statusInfo(subject, t);
  const safeSkip = getSafeSkipCount(subject.attended, subject.total, required);
  const missed = Math.max(subject.total - subject.attended, 0);
  const displayName = subject.displayName || subject.name;
  const showCode = Boolean(subject.code) && displayName !== subject.code;

  return (
    <Pressable style={[styles.subjectCard, { backgroundColor: t.card, borderColor: t.border }]} onPress={onPress}>
      <View style={styles.subjectCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.subjectName, { color: t.text }]} numberOfLines={1}>{displayName}</Text>
          {showCode ? <Text style={[styles.subjectCode, { color: t.muted }]}>{subject.code}</Text> : null}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
          <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.cardMiddle}>
        <View style={{ flex: 1 }}>
          <View style={styles.subjectMetaRow}>
            <Text style={[styles.subjectMeta, { color: t.subtext }]}>Attended: {subject.attended}/{subject.total}</Text>
          </View>
          <View style={styles.subjectMetaRow}>
            <Text style={[styles.subjectMeta, { color: t.subtext }]}>Missed: {missed}</Text>
          </View>
          <View style={styles.subjectMetaRow}>
            <Text style={[styles.subjectMeta, { color: t.subtext }]}>Required: {required}%</Text>
          </View>
        </View>
        <ProgressRing
          percentage={percentage}
          color={status.color}
          track={t.track}
          label={formatPercentage(percentage)}
        />
      </View>

      <View style={[styles.safeSkipBox, { backgroundColor: t.panel, borderColor: t.border }]}>
        {percentage >= required ? (
          <Text style={[styles.safeSkipText, { color: t.text }]}>You can skip {safeSkip} more class{safeSkip === 1 ? '' : 'es'}</Text>
        ) : (
          <Text style={[styles.safeSkipText, { color: t.bad }]}>Attendance below required percentage</Text>
        )}
      </View>
    </Pressable>
  );
}

function SubjectDetail({ subject, onRename }) {
  const t = useTheme();
  const [renameValue, setRenameValue] = useState(subject.displayName || subject.name);
  const required = subject.requiredPercentage ?? CONFIG.defaultRequiredAttendance;
  const percentage = getPercentage(subject.attended, subject.total);
  const safeSkip = getSafeSkipCount(subject.attended, subject.total, required);
  const needed = getClassesToAttend(subject.attended, subject.total, required);
  const missed = Math.max(subject.total - subject.attended, 0);
  const displayName = subject.displayName || subject.name;
  const scenarios = [
    { label: 'Attend next 1 class', attend: 1, skip: 0 }, { label: 'Attend next 3 classes', attend: 3, skip: 0 },
    { label: 'Attend next 5 classes', attend: 5, skip: 0 }, { label: 'Skip next 1 class', attend: 0, skip: 1 },
    { label: 'Skip next 2 classes', attend: 0, skip: 2 }, { label: 'Skip next 3 classes', attend: 0, skip: 3 },
  ];
  return (
    <View>
      <Text style={[styles.modalSubjectName, { color: t.text }]}>{displayName}</Text>
      {subject.code && displayName !== subject.code ? (
        <Text style={[styles.subjectCode, { color: t.muted, marginTop: -10, marginBottom: 12 }]}>{subject.code}</Text>
      ) : null}

      <View style={[styles.detailCard, { backgroundColor: t.panel, borderColor: t.border }]}>
        <InfoRow label="Total Classes" value={String(subject.total)} />
        <InfoRow label="Attended" value={String(subject.attended)} />
        <InfoRow label="Missed" value={String(missed)} />
        <InfoRow label="Current Attendance" value={formatPercentage(percentage)} valueColor={percentage >= required ? t.good : t.bad} />
        <InfoRow label="Required Attendance" value={`${required}%`} />
      </View>

      <Text style={[styles.sectionTitle, { color: t.text }]}>Advice</Text>
      <View style={[styles.adviceCard, { backgroundColor: t.adviceBg, borderColor: t.adviceBorder }]}>
        {percentage >= required ? (
          <Text style={[styles.adviceText, { color: t.adviceText }]}>You can skip {safeSkip} more class{safeSkip === 1 ? '' : 'es'} and still stay at or above {required}%.</Text>
        ) : Number.isFinite(needed) ? (
          <Text style={[styles.adviceText, { color: t.bad }]}>Attendance is low. Attend the next {needed} class{needed === 1 ? '' : 'es'} continuously to reach {required}%.</Text>
        ) : (
          <Text style={[styles.adviceText, { color: t.bad }]}>Recovery by attending future classes alone is not possible at 100% requirement.</Text>
        )}
      </View>

      <Text style={[styles.sectionTitle, { color: t.text }]}>What Will Happen?</Text>
      <View style={[styles.detailCard, { backgroundColor: t.panel, borderColor: t.border }]}>
        {scenarios.map(item => {
          const future = projectAttendance(subject.attended, subject.total, item.attend, item.skip);
          return (
            <View key={item.label} style={[styles.whatIfRow, { borderBottomColor: t.border }]}>
              <Text style={[styles.whatIfLabel, { color: t.subtext }]}>{item.label}</Text>
              <Text style={[styles.whatIfValue, { color: future >= required ? t.good : t.bad }]}>{formatPercentage(future)}</Text>
            </View>
          );
        })}
      </View>

      {subject.code ? (
        <React.Fragment>
          <Text style={[styles.sectionTitle, { color: t.text }]}>Display Name</Text>
          <View style={[styles.detailCard, { backgroundColor: t.panel, borderColor: t.border }]}>
            <TextInput
              style={[styles.input, { backgroundColor: t.card, borderColor: t.border, color: t.text, marginBottom: 10 }]}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Subject name"
              placeholderTextColor={t.muted}
            />
            <Pressable style={[styles.renameSave, { backgroundColor: t.accent }]} onPress={() => onRename(subject.code, renameValue.trim())}>
              <Text style={styles.renameSaveText}>Save Name</Text>
            </Pressable>
          </View>
        </React.Fragment>
      ) : null}

      <CreatorTag />
    </View>
  );
}

function SyncOverlay({ progress, stage }) {
  const t = useTheme();
  return (
    <View style={[styles.overlay, { backgroundColor: t.overlayDim }]} pointerEvents="none">
      <View style={[styles.overlayCard, { backgroundColor: t.card }]}>
        <View style={[styles.overlayLogo, { backgroundColor: t.accent }]}><Text style={styles.overlayLogoText}>EC</Text></View>
        <Text style={[styles.overlayTitle, { color: t.text }]}>Syncing Attendance</Text>
        <View style={[styles.progressTrack, { backgroundColor: t.track }]}>
          <View style={[styles.progressFill, { width: `${progress}%`, backgroundColor: t.accent }]} />
        </View>
        <Text style={[styles.progressPercent, { color: t.accent }]}>{progress}%</Text>
        <Text style={[styles.progressStage, { color: t.subtext }]}>{stage}</Text>
      </View>
    </View>
  );
}

function ExamTypeCard({ meta, entries, onPress }) {
  const t = useTheme();
  const dated = Object.values(entries || {}).filter(e => e && e.date);
  let sub = 'Tap to add subject dates';
  if (dated.length) {
    const future = dated.map(e => daysUntil(e.date)).filter(d => d >= 0).sort((a, b) => a - b);
    if (future.length) sub = `${dated.length} subject${dated.length === 1 ? '' : 's'} • nearest ${future[0] === 0 ? 'today' : future[0] === 1 ? 'tomorrow' : `in ${future[0]} days`}`;
    else sub = `${dated.length} subject${dated.length === 1 ? '' : 's'} • all passed`;
  }
  return (
    <Pressable style={[styles.examCard, { backgroundColor: t.card, borderColor: t.border }]} onPress={onPress}>
      <View style={[styles.examIcon, { backgroundColor: t.panel }]}>
        <Text style={styles.examIconText}>{meta.icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.examCardLabel, { color: t.text }]}>{meta.label}</Text>
        <Text style={[styles.examCardDesc, { color: t.subtext }]}>{meta.desc}</Text>
        <Text style={[styles.examCardSub, { color: dated.length ? t.accent : t.muted }]}>{sub}</Text>
      </View>
      <Text style={[styles.examChevron, { color: t.muted }]}>›</Text>
    </Pressable>
  );
}

function ExamEntryRow({ subject, entry, onDate, onTime }) {
  const t = useTheme();
  const displayName = subject.displayName || subject.name;
  return (
    <View style={[styles.subjectCard, { backgroundColor: t.card, borderColor: t.border }]}>
      <View style={styles.subjectCardTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.subjectName, { color: t.text }]} numberOfLines={2}>{displayName}</Text>
          {subject.code && displayName !== subject.code ? <Text style={[styles.subjectCode, { color: t.muted }]}>{subject.code}</Text> : null}
        </View>
        {entry && entry.date ? (
          <View style={[styles.statusBadge, { backgroundColor: daysUntil(entry.date) <= 1 ? t.chipBad : t.chipInfo }]}>
            <Text style={[styles.statusBadgeText, { color: daysUntil(entry.date) <= 1 ? t.bad : t.info }]}>{countdownLabel(entry.date)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.examBtnRow}>
        <Pressable style={[styles.examBtn, { backgroundColor: t.panel, borderColor: t.border }]} onPress={onDate}>
          <Text style={[styles.examBtnText, { color: entry && entry.date ? t.text : t.muted }]}>
            📅 {entry && entry.date ? formatDisplayDate(entry.date) : 'Set date'}
          </Text>
        </Pressable>
        <Pressable style={[styles.examBtn, { backgroundColor: t.panel, borderColor: t.border }]} onPress={onTime}>
          <Text style={[styles.examBtnText, { color: entry && entry.time ? t.text : t.muted }]}>
            🕙 {entry && entry.time ? formatDisplayTime(entry.time) : 'Set time'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Main App                                                            */
/* ------------------------------------------------------------------ */
function AppInner() {
  const insets = useSafeAreaInsets();
  const [theme, setTheme] = useState('light');
  const [tab, setTab] = useState('home');
  const [examView, setExamView] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [examsData, setExamsData] = useState({ CA1: {}, CA2: {}, SEMESTER: {} });
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [selected, setSelected] = useState(null);

  const [loginMode, setLoginMode] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');

  const [syncActive, setSyncActive] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStage, setSyncStage] = useState('');

  const [toast, setToast] = useState(null);
  const [picker, setPicker] = useState(null);
  const [portalIdx, setPortalIdx] = useState(0);

  const webviewRef = useRef(null);
  const syncingRef = useRef(false);
  const silentRef = useRef(false);
  const pendingCredsRef = useRef(null);
  const awaitingLoginResultRef = useRef(false);
  const lastDiagRef = useRef(null);
  const prevJsonRef = useRef('');
  const overridesRef = useRef({});

  const t = THEMES[theme];

  const withDisplay = useCallback((list, ov) => list.map(s => ({ ...s, displayName: (s.code && ov[s.code]) || s.name })), []);

  useEffect(() => {
    (async () => {
      try {
        const th = await AsyncStorage.getItem(STORAGE_KEYS.theme);
        if (th === 'dark' || th === 'light') setTheme(th);
        const ovRaw = await AsyncStorage.getItem(STORAGE_KEYS.overrides);
        if (ovRaw) { const ov = JSON.parse(ovRaw); setOverrides(ov); overridesRef.current = ov; }
        const exRaw = await AsyncStorage.getItem(STORAGE_KEYS.exams);
        if (exRaw) setExamsData({ CA1: {}, CA2: {}, SEMESTER: {}, ...JSON.parse(exRaw) });
        const raw = await AsyncStorage.getItem(STORAGE_KEYS.data);
        const at = await AsyncStorage.getItem(STORAGE_KEYS.syncedAt);
        if (raw) { const parsed = JSON.parse(raw); setSubjects(parsed); prevJsonRef.current = JSON.stringify(parsed); } else { setLoginMode(true); }
        if (at) setLastSyncedAt(at);
      } catch (e) {}
      setLoadingSaved(false);
    })();
  }, []);

  useEffect(() => {
    if (!loadingSaved && subjects.length > 0) startSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSaved]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEYS.theme, next).catch(() => {});
      return next;
    });
  }, []);

  const startSync = useCallback((silent = false) => {
    silentRef.current = silent;
    syncingRef.current = true;
    if (!silent) { setSyncActive(true); setSyncProgress(10); setSyncStage('Connecting to college portal...'); }
    if (webviewRef.current) webviewRef.current.reload();
  }, []);

  const finishSync = useCallback((mappedRaw, silent) => {
    const mapped = withDisplay(mappedRaw, overridesRef.current);
    const now = new Date().toISOString();
    setSubjects(mapped);
    setLastSyncedAt(now);
    AsyncStorage.setItem(STORAGE_KEYS.data, JSON.stringify(mapped)).catch(() => {});
    AsyncStorage.setItem(STORAGE_KEYS.syncedAt, now).catch(() => {});

    const newJson = JSON.stringify(mapped);
    const changed = newJson !== prevJsonRef.current;
    prevJsonRef.current = newJson;

    const totalAttended = mapped.reduce((s, i) => s + i.attended, 0);
    const totalClasses = mapped.reduce((s, i) => s + i.total, 0);
    const overall = getPercentage(totalAttended, totalClasses);

    const warns = computeWarnings(mapped);
    setSyncProgress(100);
    setSyncStage('Sync complete!');

    awaitingLoginResultRef.current = false;
    setLoginMode(false);
    setLoginError('');

    if (!silent || changed || warns.length) {
      if (warns.length) {
        const body = warns.slice(0, 2).map(w => w.text).join(' • ');
        setToast({ title: '⚠️ Attendance warning', body });
        sendSystemNotification('⚠️ Attendance warning', body);
      } else {
        const body = `Overall ${formatPercentage(overall)} across ${mapped.length} subjects`;
        setToast({ title: 'Sync complete ✅', body });
        sendSystemNotification('Attendance synced ✅', body);
      }
      setTimeout(() => setToast(null), 3200);
    }
    setTimeout(() => { setSyncActive(false); syncingRef.current = false; }, 700);
  }, [withDisplay]);

  const diagSuffix = useCallback(() => {
    if (!lastDiagRef.current) return '';
    return ' [DBG ' + JSON.stringify(lastDiagRef.current).slice(0, 350) + ']';
  }, []);

  const onWebViewMessage = useCallback(event => {
    let payload;
    try { payload = JSON.parse(event.nativeEvent.data); } catch (e) { return; }
    if (!payload) return;

    if (payload.type === 'ATTENDANCE_CAPTURED') {
      if (!syncingRef.current) return;
      setSyncProgress(85);
      setSyncStage('Saving your attendance...');
      finishSync(payload.subjects, silentRef.current);
    }
    else if (payload.type === 'LOGIN_DIAG') {
      lastDiagRef.current = payload.diag;
    }
    else if (payload.type === 'LOGIN_PAGE') {
      if (awaitingLoginResultRef.current) {
        awaitingLoginResultRef.current = false;
        pendingCredsRef.current = null;
        syncingRef.current = false;
        setSyncActive(false);
        setLoginError('Login was rejected by the portal. Re-check User ID & Password and try again.' + diagSuffix());
        setLoginMode(true);
        return;
      }
      if (!syncingRef.current) return;
      syncingRef.current = false;
      setSyncActive(false);
      if (!silentRef.current) setLoginMode(true);
    }
    else if (payload.type === 'LOGIN_FAILED') {
      awaitingLoginResultRef.current = false;
      pendingCredsRef.current = null;
      syncingRef.current = false;
      setSyncActive(false);
      if (payload.diag) lastDiagRef.current = payload.diag;
      setLoginError('Could not reach the college login form. Tap "Login & Sync" to try again.' + diagSuffix());
      setLoginMode(true);
    }
    else if (payload.type === 'NO_DATA' || payload.type === 'FETCH_ERROR') {
      syncingRef.current = false;
      setSyncActive(false);
      if (!silentRef.current) Alert.alert('Sync issue', 'You are logged in, but attendance could not be read. Tap Sync to try again.');
    }
  }, [finishSync, diagSuffix]);

  const submitLogin = useCallback(() => {
    if (!userId.trim() || !password.trim()) { setLoginError('Enter both User ID and Password.'); return; }
    pendingCredsRef.current = { u: userId.trim(), p: password };
    awaitingLoginResultRef.current = true;
    lastDiagRef.current = null;
    setLoginError('');
    silentRef.current = false;
    syncingRef.current = true;
    setSyncActive(true);
    setSyncProgress(40);
    setSyncStage('Signing you in securely...');
    if (webviewRef.current) webviewRef.current.reload();
  }, [userId, password]);

  const cancelLogin = useCallback(() => {
    pendingCredsRef.current = null;
    awaitingLoginResultRef.current = false;
    syncingRef.current = false;
    setSyncActive(false);
    setLoginMode(false);
    setLoginError('');
  }, []);

  const doLogout = useCallback(async () => {
    try {
      if (webviewRef.current) {
        webviewRef.current.stopLoading();
        webviewRef.current.injectJavaScript("window.location.href='/default/index/logout'; true;");
      }
    } catch (e) {}
    syncingRef.current = false;
    silentRef.current = false;
    pendingCredsRef.current = null;
    awaitingLoginResultRef.current = false;
    setSubjects([]);
    setLastSyncedAt(null);
    setExamsData({ CA1: {}, CA2: {}, SEMESTER: {} });
    setOverrides({});
    overridesRef.current = {};
    prevJsonRef.current = '';
    setSelected(null);
    setExamView(null);
    setTab('home');
    setLoginMode(true);
    setLoginError('');
    try {
      await AsyncStorage.multiRemove([STORAGE_KEYS.data, STORAGE_KEYS.syncedAt, STORAGE_KEYS.exams, STORAGE_KEYS.overrides]);
    } catch (e) {}
    setToast({ title: 'Logged out 👋', body: 'College session ended and phone data cleared.' });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const confirmLogout = useCallback(() => {
    Alert.alert(
      'Logout',
      'Log out of your college account on this phone? Saved attendance, exam schedules and subject names will be cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: doLogout },
      ]
    );
  }, [doLogout]);

  const saveRename = useCallback((code, newName) => {
    if (!newName) return;
    setOverrides(prev => {
      const next = { ...prev, [code]: newName };
      overridesRef.current = next;
      AsyncStorage.setItem(STORAGE_KEYS.overrides, JSON.stringify(next)).catch(() => {});
      setSubjects(list => list.map(s => (s.code === code ? { ...s, displayName: newName } : s)));
      return next;
    });
    setSelected(null);
    setToast({ title: 'Name saved ✏️', body: newName });
    setTimeout(() => setToast(null), 2000);
  }, []);

  const saveExamEntry = useCallback((type, code, entry) => {
    setExamsData(prev => {
      const next = { ...prev, [type]: { ...(prev[type] || {}), [code]: entry } };
      AsyncStorage.setItem(STORAGE_KEYS.exams, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const onPickerChange = useCallback((event, selectedValue) => {
    if (!picker) return;
    if (event.type === 'dismissed' || !selectedValue) { setPicker(null); return; }
    const entry = (examsData[picker.type] || {})[picker.code] || {};
    const next = { ...entry };
    if (picker.mode === 'date') next.date = toISODate(selectedValue);
    else next.time = toHHMM(selectedValue);
    setPicker(null);
    saveExamEntry(picker.type, picker.code, next);
    setToast({ title: 'Saved ✅', body: 'Exam schedule stored on this phone' });
    setTimeout(() => setToast(null), 1500);
  }, [picker, examsData, saveExamEntry]);

  let pickerValue = new Date();
  if (picker) {
    const entry = (examsData[picker.type] || {})[picker.code] || {};
    if (picker.mode === 'date') pickerValue = entry.date ? parseISODate(entry.date) : new Date();
    else if (entry.time) {
      const [h, m] = entry.time.split(':').map(Number);
      const d = new Date(); d.setHours(h, m, 0, 0); pickerValue = d;
    } else { const d = new Date(); d.setHours(10, 0, 0, 0); pickerValue = d; }
  }

  const examMeta = EXAM_TYPES.find(e => e.key === examView);

  return (
    <ThemeContext.Provider value={t}>
      <View style={[styles.container, { backgroundColor: t.bg }]}>
        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />

        {/* HIDDEN background browser — the college site is never visible */}
        <View pointerEvents="none" style={styles.hiddenBrowser}>
          <WebView
            ref={webviewRef}
            source={{ uri: CONFIG.portals[portalIdx] }}
            style={{ flex: 1 }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onMessage={onWebViewMessage}
            onError={() => {
              if (portalIdx < CONFIG.portals.length - 1) {
                setPortalIdx(portalIdx + 1);
              } else {
                syncingRef.current = false;
                pendingCredsRef.current = null;
                awaitingLoginResultRef.current = false;
                setSyncActive(false);
                setLoginMode(true);
                setLoginError('College server is not reachable right now. Check your internet and tap "Login & Sync" again in a minute.');
              }
            }}
            onLoadEnd={() => {
              if (pendingCredsRef.current) {
                const creds = pendingCredsRef.current;
                pendingCredsRef.current = null;
                setSyncProgress(60);
                setSyncStage('Submitting credentials...');
                if (webviewRef.current) webviewRef.current.injectJavaScript(buildLoginJs(creds.u, creds.p));
                return;
              }
              if (syncingRef.current && !silentRef.current) { setSyncProgress(30); setSyncStage('Checking your session...'); }
              if (webviewRef.current) webviewRef.current.injectJavaScript(CHECK_JS);
            }}
          />
        </View>

        {loginMode ? (
          <View style={[styles.loginScreen, { backgroundColor: t.bg, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 16 }]}>
            <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.loginLogoWrap}>
                <View style={[styles.loginLogo, { backgroundColor: t.accent }]}>
                  <Text style={styles.loginLogoText}>EC</Text>
                </View>
                <Text style={[styles.loginCollege, { color: t.subtext }]}>{CONFIG.collegeName}</Text>
                <Text style={[styles.loginAppTitle, { color: t.text }]}>{CONFIG.appName}</Text>
              </View>

              <View style={[styles.loginCard, { backgroundColor: t.card, borderColor: t.border }]}>
                <Text style={[styles.loginCardTitle, { color: t.text }]}>Student Login</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: t.panel, borderColor: t.border, color: t.text }]}
                  placeholder="User ID (Register Number)"
                  placeholderTextColor={t.muted}
                  value={userId}
                  onChangeText={setUserId}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: t.panel, borderColor: t.border, color: t.text }]}
                  placeholder="Password"
                  placeholderTextColor={t.muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={true}
                />
                {loginError ? <Text style={[styles.loginError, { color: t.bad }]}>{loginError}</Text> : null}
                <Pressable
                  style={[styles.primaryButtonFull, { backgroundColor: syncActive ? t.muted : t.accent }]}
                  onPress={submitLogin}
                  disabled={syncActive}
                >
                  {syncActive ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Login & Sync</Text>
                  )}
                </Pressable>
                {subjects.length > 0 ? (
                  <Pressable style={styles.cancelButton} onPress={cancelLogin} disabled={syncActive}>
                    <Text style={[styles.cancelButtonText, { color: t.subtext }]}>Cancel — go to my dashboard</Text>
                  </Pressable>
                ) : null}
              </View>

              <CreatorTag />
            </ScrollView>
          </View>
        ) : (
          <React.Fragment>
            <View style={[styles.header, { backgroundColor: t.card, borderBottomColor: t.border, paddingTop: insets.top + 16 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.headerCollege, { color: t.subtext }]}>{CONFIG.collegeName}</Text>
                {lastSyncedAt && tab === 'home' ? <Text style={[styles.syncedText, { color: t.muted }]}>Last synced: {new Date(lastSyncedAt).toLocaleString()}</Text> : null}
              </View>
              {subjects.length > 0 ? (
                <Pressable
                  style={[styles.iconButton, { borderColor: t.border, backgroundColor: t.panel }]}
                  onPress={confirmLogout}
                  accessibilityLabel="Logout"
                >
                  <Text style={styles.iconButtonText}>🚪</Text>
                </Pressable>
              ) : null}
              <Pressable style={[styles.iconButton, { borderColor: t.border, backgroundColor: t.panel }]} onPress={toggleTheme}>
                <Text style={styles.iconButtonText}>{theme === 'dark' ? '☀️' : '🌙'}</Text>
              </Pressable>
              <Pressable style={[styles.syncButton, { backgroundColor: t.accent }]} onPress={() => startSync(false)}>
                <Text style={styles.syncButtonText}>Sync Now</Text>
              </Pressable>
            </View>

            {tab === 'home' ? (
              loadingSaved ? (
                <View style={styles.centerContainer}><ActivityIndicator size="large" color={t.accent} /></View>
              ) : subjects.length === 0 ? null : (
                <FlatList
                  data={subjects}
                  keyExtractor={item => item.id}
                  contentContainerStyle={[styles.listContent, { paddingBottom: 32 + insets.bottom }]}
                  ListHeaderComponent={<SummaryCard subjects={subjects} />}
                  renderItem={({ item }) => <SubjectCard subject={item} onPress={() => setSelected(item)} />}
                  ListFooterComponent={<CreatorTag />}
                />
              )
            ) : examView ? (
              <ScrollView contentContainerStyle={[styles.listContent, { paddingBottom: 32 + insets.bottom }]}>
                <Pressable onPress={() => setExamView(null)} style={styles.backRow}>
                  <Text style={[styles.backText, { color: t.accent }]}>← All exams</Text>
                </Pressable>
                <Text style={[styles.examViewTitle, { color: t.text }]}>{examMeta.icon} {examMeta.label} — Schedule</Text>
                <Text style={[styles.examViewSub, { color: t.subtext }]}>
                  Tap “Set date” / “Set time” for each subject. Everything saves automatically on this phone.
                </Text>
                {subjects.length === 0 ? (
                  <Text style={[styles.emptyText, { color: t.subtext }]}>Sync your attendance first — your subjects will appear here automatically.</Text>
                ) : (
                  subjects.map(s => (
                    <ExamEntryRow
                      key={s.id}
                      subject={s}
                      entry={(examsData[examView] || {})[s.code || s.id]}
                      onDate={() => setPicker({ mode: 'date', type: examView, code: s.code || s.id })}
                      onTime={() => setPicker({ mode: 'time', type: examView, code: s.code || s.id })}
                    />
                  ))
                )}
                <CreatorTag />
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={[styles.listContent, { paddingBottom: 32 + insets.bottom }]}>
                <Text style={[styles.examViewTitle, { color: t.text }]}>Exams</Text>
                <Text style={[styles.examViewSub, { color: t.subtext }]}>Your personal exam planner — saved on this phone, always available offline.</Text>
                {EXAM_TYPES.map(et => (
                  <ExamTypeCard key={et.key} meta={et} entries={examsData[et.key]} onPress={() => setExamView(et.key)} />
                ))}
                <CreatorTag />
              </ScrollView>
            )}

            <View style={[styles.tabBar, { backgroundColor: t.card, borderTopColor: t.border, paddingBottom: insets.bottom }]}>
              <Pressable style={[styles.tab, tab === 'home' && { borderTopWidth: 2, borderTopColor: t.accent }]} onPress={() => { setTab('home'); setExamView(null); }}>
                <Text style={[styles.tabText, { color: tab === 'home' ? t.accent : t.subtext }]}>🏠 Dashboard</Text>
              </Pressable>
              <Pressable style={[styles.tab, tab === 'exams' && { borderTopWidth: 2, borderTopColor: t.accent }]} onPress={() => setTab('exams')}>
                <Text style={[styles.tabText, { color: tab === 'exams' ? t.accent : t.subtext }]}>🎓 Exams</Text>
              </Pressable>
            </View>
          </React.Fragment>
        )}

        {picker ? (
          <DateTimePicker
            value={pickerValue}
            mode={picker.mode}
            is24Hour={false}
            display="default"
            onChange={onPickerChange}
          />
        ) : null}

        {syncActive ? <SyncOverlay progress={syncProgress} stage={syncStage} /> : null}

        {toast ? (
          <View style={[styles.toast, { top: insets.top + 12 }]} pointerEvents="none">
            <Text style={styles.toastTitle}>{toast.title}</Text>
            <Text style={styles.toastBody}>{toast.body}</Text>
          </View>
        ) : null}

        <Modal visible={Boolean(selected)} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
          <View style={[styles.modalOverlay, { backgroundColor: t.overlayDim }]}>
            <View style={[styles.modalContainer, { backgroundColor: t.card, paddingBottom: 20 + insets.bottom }]}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {selected ? <SubjectDetail subject={selected} onRename={saveRename} /> : null}
              </ScrollView>
              <Pressable style={[styles.closeButton, { backgroundColor: t.closeBg }]} onPress={() => setSelected(null)}>
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </ThemeContext.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenBrowser: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 8 },
  headerCollege: { fontSize: 13, marginBottom: 2 },
  syncedText: { fontSize: 11, marginTop: 4 },
  iconButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconButtonText: { fontSize: 17 },
  syncButton: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  syncButtonText: { color: '#ffffff', fontWeight: '800' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  primaryButtonFull: { paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 6 },
  primaryButtonText: { color: '#ffffff', fontWeight: '800' },
  listContent: { padding: 16 },
  creatorText: { textAlign: 'center', fontSize: 12, fontStyle: 'italic', marginTop: 22, marginBottom: 6 },
  loginScreen: { flex: 1, paddingHorizontal: 24 },
  loginScroll: { flexGrow: 1, justifyContent: 'center' },
  loginLogoWrap: { alignItems: 'center', marginBottom: 22 },
  loginLogo: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  loginLogoText: { color: '#ffffff', fontSize: 26, fontWeight: '900' },
  loginCollege: { fontSize: 12, marginBottom: 4, textAlign: 'center' },
  loginAppTitle: { fontSize: 26, fontWeight: '900', textAlign: 'center' },
  loginCard: { borderWidth: 1, borderRadius: 24, padding: 20 },
  loginCardTitle: { fontSize: 20, fontWeight: '900', marginBottom: 14 },
  loginError: { fontSize: 12, marginBottom: 8, fontWeight: '700' },
  cancelButton: { paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  cancelButtonText: { fontWeight: '700' },
  summaryCard: { backgroundColor: '#2563eb', borderRadius: 20, padding: 18, marginBottom: 12 },
  summaryTitle: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 4 },
  summaryPercentage: { color: '#ffffff', fontSize: 40, fontWeight: '900' },
  summarySubtext: { color: 'rgba(255,255,255,0.88)', marginTop: 4, marginBottom: 16 },
  summaryStatsRow: { flexDirection: 'row', gap: 10 },
  summaryStatBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  summaryStatValue: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
  summaryStatLabel: { color: 'rgba(255,255,255,0.82)', fontSize: 12, marginTop: 2 },
  subjectCard: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12 },
  subjectCardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  subjectName: { fontSize: 17, fontWeight: '800' },
  subjectCode: { fontSize: 12, marginTop: 2, fontWeight: '600', letterSpacing: 0.3 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusBadgeText: { fontSize: 12, fontWeight: '800' },
  cardMiddle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  subjectMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  subjectMeta: { fontSize: 13 },
  subjectPercentage: { fontWeight: '900' },
  safeSkipBox: { marginTop: 10, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  safeSkipText: { fontWeight: '600' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  overlayCard: { width: '80%', borderRadius: 24, padding: 24, alignItems: 'center' },
  overlayLogo: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  overlayLogoText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  overlayTitle: { fontSize: 18, fontWeight: '900', marginBottom: 16 },
  progressTrack: { width: '100%', height: 10, borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: 10, borderRadius: 5 },
  progressPercent: { fontSize: 26, fontWeight: '900', marginTop: 12 },
  progressStage: { marginTop: 4, textAlign: 'center' },
  toast: { position: 'absolute', left: 16, right: 16, backgroundColor: '#16a34a', borderRadius: 16, padding: 14, elevation: 9, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  toastTitle: { color: '#ffffff', fontWeight: '900', fontSize: 15 },
  toastBody: { color: '#dcfce7', fontSize: 13, marginTop: 2 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabText: { fontWeight: '800', fontSize: 14 },
  backRow: { marginBottom: 10 },
  backText: { fontWeight: '800', fontSize: 15 },
  examViewTitle: { fontSize: 22, fontWeight: '900', marginBottom: 6 },
  examViewSub: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  examCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12, gap: 14 },
  examIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  examIconText: { fontSize: 24 },
  examCardLabel: { fontSize: 17, fontWeight: '900' },
  examCardDesc: { fontSize: 12, marginTop: 2 },
  examCardSub: { fontSize: 12, marginTop: 6, fontWeight: '700' },
  examChevron: { fontSize: 26, fontWeight: '700' },
  examBtnRow: { flexDirection: 'row', gap: 10 },
  examBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  examBtnText: { fontWeight: '700', fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, fontSize: 15 },
  sectionTitle: { fontSize: 16, fontWeight: '900', marginTop: 18, marginBottom: 8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalContainer: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 20, maxHeight: '88%' },
  modalSubjectName: { fontSize: 24, fontWeight: '900', marginBottom: 14 },
  detailCard: { borderWidth: 1, borderRadius: 16, padding: 14 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1 },
  infoValue: { fontWeight: '800' },
  adviceCard: { borderWidth: 1, borderRadius: 16, padding: 14 },
  adviceText: { lineHeight: 20, fontWeight: '600' },
  whatIfRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1 },
  whatIfLabel: { flex: 1, paddingRight: 12 },
  whatIfValue: { fontWeight: '900' },
  renameSave: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  renameSaveText: { color: '#ffffff', fontWeight: '800' },
  closeButton: { marginTop: 16, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  closeButtonText: { color: '#ffffff', fontWeight: '800' },
});