import { useState, useEffect, useRef } from "react";
import { db, auth } from "./firebase";
import {
  doc, getDoc, setDoc, onSnapshot
} from "firebase/firestore";
import emailjs from "@emailjs/browser";

const CATEGORIES = ["All", "General", "3D Printing", "Ceramics", "Textiles/Fine Arts", "Woodshop", "Electronics"];

const UNIT_OPTIONS = ["units", "rolls", "sheets", "kg", "g", "lbs", "oz", "m", "ft", "L", "mL", "bottles", "cans", "boxes", "spools"];

const STATUS = (item) => {
  const ratio = item.quantity / item.lowStockThreshold;
  if (item.quantity === 0) return "out";
  if (ratio <= 1) return "low";
  if (ratio <= 2) return "ok";
  return "good";
};

const STATUS_STYLES = {
  out: { label: "OUT", bg: "#FF2D2D", text: "#fff" },
  low: { label: "LOW", bg: "#FF8C00", text: "#fff" },
  ok: { label: "OK", bg: "#C8A400", text: "#fff" },
  good: { label: "GOOD", bg: "#2CB67D", text: "#fff" },
};

const SEED_DATA = [
  { id: 1, name: "PLA Filament – Black", category: "3D Printing", quantity: 2, unit: "spools", lowStockThreshold: 3, supplier: "Hatchbox", supplierUrl: "", notes: "1.75mm, 1kg spools" },
  { id: 2, name: "PLA Filament – White", category: "3D Printing", quantity: 5, unit: "spools", lowStockThreshold: 3, supplier: "Hatchbox", supplierUrl: "", notes: "" },
  { id: 3, name: "Sandpaper 120-grit", category: "Woodshop", quantity: 40, unit: "sheets", lowStockThreshold: 20, supplier: "Home Depot", supplierUrl: "", notes: "" },
  { id: 4, name: "Sandpaper 220-grit", category: "Woodshop", quantity: 8, unit: "sheets", lowStockThreshold: 20, supplier: "Home Depot", supplierUrl: "", notes: "" },
  { id: 5, name: "Super Glue", category: "General", quantity: 3, unit: "bottles", lowStockThreshold: 5, supplier: "Amazon", supplierUrl: "", notes: "Loctite Ultra Gel" },
  { id: 6, name: "Wood Glue", category: "Woodshop", quantity: 1, unit: "bottles", lowStockThreshold: 2, supplier: "Titebond", supplierUrl: "", notes: "" },
  { id: 7, name: "Paper Towels", category: "General", quantity: 4, unit: "rolls", lowStockThreshold: 6, supplier: "Costco", supplierUrl: "", notes: "" },
  { id: 8, name: "Nitrile Gloves (M)", category: "General", quantity: 80, unit: "units", lowStockThreshold: 50, supplier: "Uline", supplierUrl: "", notes: "Medium size" },
];

function genId() { return Date.now() + Math.random(); }

const defaultItem = () => ({
  id: genId(),
  name: "",
  category: "General",
  quantity: 0,
  unit: "units",
  lowStockThreshold: 5,
  supplier: "",
  supplierUrl: "",
  notes: "",
  assignedMemberId: "",
});

export default function App() {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem("makerspace_inventory");
      return raw ? JSON.parse(raw) : SEED_DATA;
    } catch { return SEED_DATA; }
  });

  // Firebase realtime sync
  const [storageReady, setStorageReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const isEditingRef = useRef(false);
  const skipNextSnapshotRef = useRef(false); // prevent echo after local write

  // Save items to Firestore
  async function saveItems(newItems) {
    try {
      await setDoc(doc(db, "sparkstock", "inventory"), { items: newItems });
    } catch (e) { console.error("Save error:", e); }
  }

  // Save a single config key to Firestore
  async function storageSave(key, value) {
    try {
      await setDoc(doc(db, "sparkstock", "config"), { [key]: value }, { merge: true });
    } catch (e) { console.error("Config save error:", e); }
  }

  // Get a config value from Firestore
  async function storageGet(key) {
    try {
      const snap = await getDoc(doc(db, "sparkstock", "config"));
      if (snap.exists()) return snap.data()[key] ?? null;
    } catch {}
    return null;
  }

  // Load initial data + subscribe to realtime updates
  useEffect(() => {
    setSyncing(true);
    const unsub = onSnapshot(doc(db, "sparkstock", "inventory"), (snap) => {
      if (skipNextSnapshotRef.current) {
        skipNextSnapshotRef.current = false;
        setSyncing(false);
        setLastSynced(new Date());
        setStorageReady(true);
        return;
      }
      if (snap.exists()) {
        const remote = snap.data().items || [];
        setItems(remote);
        setPendingQty(p => {
          const updated = {...p};
          remote.forEach(ri => {
            const local = items.find(li => li.id === ri.id);
            if (local && local.quantity !== ri.quantity && updated.hasOwnProperty(ri.id)) {
              delete updated[ri.id];
            }
          });
          return updated;
        });
      }
      setSyncing(false);
      setLastSynced(new Date());
      setStorageReady(true);
    }, (err) => {
      console.error("Snapshot error:", err);
      setSyncing(false);
      setStorageReady(true);
    });
    return () => unsub();
  }, []);

  const [filterCat, setFilterCat] = useState("All");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [sortBy, setSortBy] = useState("name");
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Auth
  const [unlocked, setUnlocked] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authInput, setAuthInput] = useState("");
  const [authError, setAuthError] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // fn to call after unlock
  const [hasPassword, setHasPassword] = useState(false);
  const [settingPassword, setSettingPassword] = useState(false);
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    async function loadAuth() {
      try {
        const pw = await storageGet("sparkstock_password");
        if (pw) setHasPassword(true);
        // Keep unlocked for session if already unlocked
      } catch {}
    }
    loadAuth();
  }, []);

  function requireAuth(action) {
    if (unlocked) { action(); return; }
    setPendingAction(() => action);
    setAuthInput("");
    setAuthError(false);
    setShowAuthModal(true);
  }

  async function submitAuth() {
    try {
      const stored = await storageGet("sparkstock_password");
      if (stored && authInput === stored) {
        setUnlocked(true);
        setShowAuthModal(false);
        setAuthError(false);
        if (pendingAction) { pendingAction(); setPendingAction(null); }
      } else {
        setAuthError(true);
        setAuthInput("");
      }
    } catch { setAuthError(true); }
  }

  async function savePassword() {
    if (!newPasswordInput.trim()) { setPasswordError("Password cannot be empty."); return; }
    if (newPasswordInput !== newPasswordConfirm) { setPasswordError("Passwords don't match."); return; }
    try {
      await storageSave("sparkstock_password", newPasswordInput);
      setHasPassword(true);
      setUnlocked(true);
      setSettingPassword(false);
      setNewPasswordInput("");
      setNewPasswordConfirm("");
      setPasswordError("");
      addToast("Password saved.");
    } catch { setPasswordError("Failed to save password."); }
  }

  async function removePassword() {
    await storageSave("sparkstock_password", "");
    setHasPassword(false);
    setUnlocked(false);
    addToast("Password removed.");
  }

  // Notifications
  const [showSettings, setShowSettings] = useState(false);
  // track settings open state for polling pause via a side-effect below
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookInput, setWebhookInput] = useState("");
  const [emailjsServiceId, setEmailjsServiceId] = useState("");
  const [emailjsTemplateId, setEmailjsTemplateId] = useState("");
  const [emailjsPublicKey, setEmailjsPublicKey] = useState("");
  const [emailjsInput, setEmailjsInput] = useState({ serviceId: "", templateId: "", publicKey: "" });
  const [alertedIds, setAlertedIds] = useState(new Set());
  const [toasts, setToasts] = useState([]);
  const [members, setMembers] = useState([]);
  const [memberForm, setMemberForm] = useState({ name: "", discordId: "", email: "" });

  // Load EmailJS SDK
  useEffect(() => {
    if (document.getElementById("emailjs-sdk")) return;
    const s = document.createElement("script");
    s.id = "emailjs-sdk";
    s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    s.onload = () => {
      
    };
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    async function loadSettings() {
      try {
        const wh = await storageGet("discord_webhook");
        if (wh) { setWebhookUrl(wh); setWebhookInput(wh); }
        const al = await storageGet("alerted_ids");
        if (al) setAlertedIds(new Set(JSON.parse(al)));
        const mb = await storageGet("discord_members");
        if (mb) setMembers(JSON.parse(mb));
        const ejs = await storageGet("emailjs_config");
        if (ejs) {
          const cfg = JSON.parse(ejs);
          setEmailjsServiceId(cfg.serviceId || "");
          setEmailjsTemplateId(cfg.templateId || "");
          setEmailjsPublicKey(cfg.publicKey || "");
          setEmailjsInput(cfg);
                    if (cfg.publicKey) emailjs.init({ publicKey: cfg.publicKey });
        }
      } catch {}
    }
    loadSettings();
  }, []);

  async function saveMember() {
    const name = memberForm.name.trim();
    const discordId = memberForm.discordId.trim().replace(/^<@!?(\d+)>$/, "$1");
    const email = memberForm.email.trim();
    if (!name || (!discordId && !email)) return;
    const newMember = { id: genId(), name, discordId, email };
    const updated = [...members, newMember];
    setMembers(updated);
    await storageSave("discord_members", JSON.stringify(updated)).catch(() => {});
    setMemberForm({ name: "", discordId: "", email: "" });
  }

  async function deleteMember(id) {
    const updated = members.filter(m => m.id !== id);
    setMembers(updated);
    await storageSave("discord_members", JSON.stringify(updated)).catch(() => {});
    setItems(prev => prev.map(i => i.assignedMemberId === id ? { ...i, assignedMemberId: "" } : i));
  }

  function addToast(msg, type = "success") {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }

  async function saveWebhook() {
    try {
      await storageSave("discord_webhook", webhookInput);
      setWebhookUrl(webhookInput);
      addToast("Discord webhook saved.");
    } catch { addToast("Failed to save webhook.", "error"); }
  }

  async function saveEmailjsConfig() {
    const cfg = { serviceId: emailjsInput.serviceId.trim(), templateId: emailjsInput.templateId.trim(), publicKey: emailjsInput.publicKey.trim() };
    if (!cfg.serviceId || !cfg.templateId || !cfg.publicKey) return;
    try {
      await storageSave("emailjs_config", JSON.stringify(cfg));
      setEmailjsServiceId(cfg.serviceId);
      setEmailjsTemplateId(cfg.templateId);
      setEmailjsPublicKey(cfg.publicKey);
            emailjs.init({ publicKey: cfg.publicKey });
      addToast("EmailJS config saved.");
    } catch { addToast("Failed to save EmailJS config.", "error"); }
  }

  async function sendEmailAlert(item, member) {
    if (!emailjsServiceId || !emailjsTemplateId || !emailjsPublicKey) return;
    if (!member?.email) return;
    
    const st = STATUS(item);
    const appUrl = window.location.href;
    const params = {
      to_name: member.name,
      to_email: member.email,
      item_name: item.name,
      status: st.toUpperCase(),
      current_qty: `${item.quantity} ${item.unit}`,
      reorder_threshold: `${item.lowStockThreshold} ${item.unit}`,
      supplier: item.supplier || "N/A",
      app_url: appUrl,
      subject: st === "out" ? `🚨 OUT OF STOCK: ${item.name}` : `⚠️ Low Stock: ${item.name}`,
    };
    try {
      await emailjs.send(emailjsServiceId, emailjsTemplateId, params);
    } catch (e) { console.warn("EmailJS error:", e); }
  }

  // Instant channel alert — fires immediately when an item goes low/out
  async function sendDiscordAlert(item) {
    if (!webhookUrl) return;
    const st = STATUS(item);
    const color = st === "out" ? 16711680 : 16744192;
    const appUrl = window.location.href;
    const assignedMember = members.find(m => m.id === item.assignedMemberId);
    const embed = {
      embeds: [{
        title: st === "out" ? "🚨 Item OUT OF STOCK" : "⚠️ Low Stock Alert",
        color,
        fields: [
          { name: "Item", value: item.name, inline: true },
          { name: "Status", value: st.toUpperCase(), inline: true },
          { name: "Current Quantity", value: `${item.quantity} ${item.unit}`, inline: true },
          { name: "Reorder Threshold", value: `${item.lowStockThreshold} ${item.unit}`, inline: true },
          ...(item.supplier ? [{ name: "Supplier", value: item.supplier, inline: true }] : []),
          ...(assignedMember ? [{ name: "Purchaser", value: assignedMember.name, inline: true }] : []),
          { name: "Inventory App", value: `[Open App](${appUrl})`, inline: false },
        ],
        footer: { text: "Spark Stock • Instant Alert" },
        timestamp: new Date().toISOString(),
      }]
    };
    try {
      await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(embed) });
    } catch {}
  }

  // Weekly digest — one message per purchaser, batching all their low/out items
  async function sendWeeklyDigests() {
    const appUrl = window.location.href;
    const lowItems = items.filter(i => ["low", "out"].includes(STATUS(i)));
    if (lowItems.length === 0) return;

    // Group by assignedMemberId
    const byMember = {};
    lowItems.forEach(item => {
      const key = item.assignedMemberId || "__unassigned__";
      if (!byMember[key]) byMember[key] = [];
      byMember[key].push(item);
    });

    for (const [memberId, memberItems] of Object.entries(byMember)) {
      const member = memberId === "__unassigned__" ? null : members.find(m => m.id === memberId);

      // Build item list string
      const NL = String.fromCharCode(10);
      const itemLines = memberItems.map(item => {
        const st = STATUS(item);
        const emoji = st === "out" ? "[OUT]" : "[LOW]";
        const supplierStr = item.supplier ? (" - " + item.supplier) : "";
        return emoji + " " + item.name + " - " + st.toUpperCase() + " (" + item.quantity + "/" + item.lowStockThreshold + " " + item.unit + ")" + supplierStr;
      }).join(NL);

      // Discord digest to channel (with mention if member has discordId)
      if (webhookUrl) {
        const mention = member?.discordId ? `<@${member.discordId}>` : null;
        const recipientName = member ? member.name : "Unassigned items";
        const embed = {
          ...(mention ? { content: mention } : {}),
          embeds: [{
            title: `📋 Weekly Restock Digest — ${recipientName}`,
            color: 16744192,
            description: itemLines,
            fields: [
              { name: "Items needing attention", value: `${memberItems.length}`, inline: true },
              { name: "Inventory App", value: `[Open App](${appUrl})`, inline: true },
            ],
            footer: { text: "Spark Stock • Monday Digest" },
            timestamp: new Date().toISOString(),
          }]
        };
        try {
          await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(embed) });
        } catch {}
      }

      // Email digest to member
      if (member?.email && emailjsServiceId && emailjsTemplateId && emailjsPublicKey) {
        const plainItemLines = memberItems.map(item => {
          const st = STATUS(item);
          const supplierStr = item.supplier ? (" - Supplier: " + item.supplier) : "";
          return "- " + item.name + " - " + st.toUpperCase() + " (" + item.quantity + "/" + item.lowStockThreshold + " " + item.unit + ")" + supplierStr;
        }).join(String.fromCharCode(10));
        const params = {
          to_name: member.name,
          to_email: member.email,
          subject: `📋 Weekly Restock Digest — ${memberItems.length} item${memberItems.length > 1 ? "s" : ""} need attention`,
          item_name: `${memberItems.length} items need restocking`,
          status: memberItems.some(i => STATUS(i) === "out") ? "OUT OF STOCK + LOW" : "LOW STOCK",
          current_qty: plainItemLines,
          reorder_threshold: "",
          supplier: "",
          app_url: appUrl,
        };
        try { await emailjs.send(emailjsServiceId, emailjsTemplateId, params); } catch {}
      }
    }

    addToast("Weekly digest sent!", "discord");
  }

  // Weekly digest scheduler — checks every minute, fires Monday 6PM ET once per week
  useEffect(() => {
    if (!storageReady) return;
    const interval = setInterval(async () => {
      const now = new Date();
      // Convert to Eastern Time
      const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
      const et = new Date(etStr);
      const day = et.getDay();   // 1 = Monday
      const hour = et.getHours();
      const min = et.getMinutes();
      if (day !== 1 || hour !== 18 || min !== 0) return;

      // Get ISO week number to ensure we only fire once per week
      const startOfYear = new Date(et.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((et - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
      const weekKey = `${et.getFullYear()}-W${weekNum}`;

      try {
        const lastSentWeek = await storageGet("digest_last_sent_week");
        if (lastSentWeek === weekKey) return; // Already sent this week
        await storageSave("digest_last_sent_week", weekKey);
        await sendWeeklyDigests();
      } catch {}
    }, 60000); // check every minute
    return () => clearInterval(interval);
  }, [storageReady, items, members, webhookUrl, emailjsServiceId]);

  const prevStatusRef = useRef({});
  useEffect(() => {
    if (!storageReady) return;
    items.forEach(item => {
      const st = STATUS(item);
      const prev = prevStatusRef.current[item.id];
      const isAlert = ["low", "out"].includes(st);
      const wasAlert = ["low", "out"].includes(prev);
      const alertKey = `${item.id}:${st}`;
      if (isAlert && !alertedIds.has(alertKey)) {
        const newAlerted = new Set(alertedIds);
        newAlerted.add(alertKey);
        setAlertedIds(newAlerted);
        storageSave("alerted_ids", JSON.stringify([...newAlerted])).catch(() => {});
        // Instant channel alert
        if (webhookUrl) {
          sendDiscordAlert(item);
          addToast(`📢 Channel alert sent for "${item.name}"`, "discord");
        }
      }
      if (!isAlert && wasAlert) {
        const newAlerted = new Set(alertedIds);
        [`${item.id}:low`, `${item.id}:out`].forEach(k => newAlerted.delete(k));
        setAlertedIds(newAlerted);
        storageSave("alerted_ids", JSON.stringify([...newAlerted])).catch(() => {});
      }
      prevStatusRef.current[item.id] = st;
    });
  }, [items, storageReady, webhookUrl]);

  const lowCount = items.filter(i => ["low", "out"].includes(STATUS(i))).length;

  const filtered = items
    .filter(i => filterCat === "All" || i.category === filterCat)
    .filter(i => filterStatus === "all" || STATUS(i) === filterStatus)
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()) || i.category.toLowerCase().includes(search.toLowerCase()) || i.supplier.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "status") return ["out","low","ok","good"].indexOf(STATUS(a)) - ["out","low","ok","good"].indexOf(STATUS(b));
      if (sortBy === "quantity") return a.quantity - b.quantity;
      if (sortBy === "category") return a.category.localeCompare(b.category);
      return 0;
    });

  function openNew() { setForm(defaultItem()); setEditingId(null); setShowForm(true); isEditingRef.current = true; }
  function openEdit(item) { setForm({...item}); setEditingId(item.id); setShowForm(true); isEditingRef.current = true; }
  function closeForm() { setShowForm(false); setForm(null); setEditingId(null); isEditingRef.current = false; }

  function saveForm() {
    if (!form.name.trim()) return;
    let newItems;
    if (editingId) {
      newItems = items.map(i => i.id === editingId ? form : i);
    } else {
      newItems = [...items, form];
    }
    skipNextSnapshotRef.current = true;
    setItems(newItems);
    saveItems(newItems);
    closeForm();
  }

  function deleteItem(id) {
    const newItems = items.filter(i => i.id !== id);
    skipNextSnapshotRef.current = true;
    setItems(newItems);
    saveItems(newItems);
    setConfirmDelete(null);
  }

  // Pending quantity changes — keyed by item id
  const [pendingQty, setPendingQty] = useState({});

  function getPending(id, fallback) {
    return pendingQty.hasOwnProperty(id) ? pendingQty[id] : fallback;
  }

  function adjustQty(id, currentQty) {
    return (delta) => {
      const base = pendingQty.hasOwnProperty(id) ? pendingQty[id] : currentQty;
      setPendingQty(p => ({...p, [id]: Math.max(0, base + delta)}));
    };
  }

  function setQty(id) {
    return (val) => {
      const n = parseFloat(val);
      if (isNaN(n) || n < 0) return;
      setPendingQty(p => ({...p, [id]: n}));
    };
  }

  function commitQty(id) {
    if (!pendingQty.hasOwnProperty(id)) return;
    const newItems = items.map(i => i.id === id ? {...i, quantity: pendingQty[id]} : i);
    skipNextSnapshotRef.current = true;
    setItems(newItems);
    saveItems(newItems);
    setPendingQty(p => { const n = {...p}; delete n[id]; return n; });
  }

  function discardQty(id) {
    setPendingQty(p => { const n = {...p}; delete n[id]; return n; });
  }

  return (
    <div style={{minHeight:"100vh", background:"#0F0F0F", fontFamily:"'Courier New', Courier, monospace", color:"#E8E0D0"}}>
      {/* Top bar */}
      <div className="top-bar" style={{background:"#1A1A1A", borderBottom:"2px solid #333", padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12}}>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <svg className="logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 580.3 518.4" style={{height:36, width:"auto", flexShrink:0}}>
            <defs><style>{`.st0{fill:#fff}`}</style></defs>
            <path className="st0" d="M532.2,333.4c11.3,40.7,5.9,78.9-16,114.7-4.1,6.7-2.7,11.4,4.6,14.4,10.3,4.3,21.2,6.3,31.9,9.2,6.7,1.8,13.2,3.8,19,7.9,5.2,3.7,8.3,8.7,8.6,15,.2,5.4-3,8.7-7.4,11-7.1,3.7-14.9,5.4-22.7,6.7-17.1,3-34.5,4.1-51.8,5-27.6,1.4-55.3,1.3-82.9.9-18.2-.2-36.4-.5-54.6-1.2-26.7-.9-52.5-5.7-76.5-18-18.7-9.5-33.6-23.3-46.3-39.8-18.8-24.7-34.9-51-47.6-79.3-3.7-8.2-7.6-16.4-12.3-24.2-5.6-9.2-12.6-17-21.3-23.2-9.7-6.9-14.5-16.3-13.6-28.3.6-8.2,3.8-15.5,8.8-22.1,6.3-8.4,6.5-12.5.9-21.3-3.3-5.2-6.7-10.4-9.8-15.8-1.6-2.6-3.6-3.8-6.7-3.8-14,.1-28.1,0-42.1,0s-14.9-7.4-12.1-16.5c2.4-7.8,5-15.4,7.4-23.2,1.5-4.6.6-6-4.2-6.9-3.7-.7-7.4-1-11.2-1.6-6.7-1-11.4-7.3-9.8-14,3.3-14.3,6.8-28.6,10.3-43,.8-3.4,2.9-4.8,5.2-4.2,2.5.7,3.5,2.9,2.7,6.1-3.2,13.3-6.3,26.7-9.6,40-1.3,5.4-.4,6.6,5.2,7.3,3.1.4,6.2.8,9.3,1.3,8.4,1.3,12.8,8.2,10.3,16.3-2.4,7.6-4.9,15.1-7.3,22.6-1.8,5.6-.5,7.3,5.2,7.3,13.9,0,27.6,0,41.5,0,5.5,0,9.5,2.1,12.4,6.8,3.3,5.5,6.8,10.9,10.2,16.3,4.6,7.1,10.3,9.2,18.2,6.9,5.5-1.6,11-2.5,16.8-2,4.8.4,8.4-3.2,8.5-8.4.1-4.5,0-9,0-13.4,0-16.7,0-33.4,0-50,0-3.6-1.3-5.9-4.3-7.7-6.8-4.1-13.4-8.4-20.1-12.6-8.6-5.4-9.8-13.7-2.9-21.3,1-1,2-2.1,2.9-3.1,2.9-3.3,2.7-5.6-.7-8.2-5.7-4.3-11.4-8.6-17-12.9-8.5-6.4-9.2-13.9-2.1-21.7,12.1-13.5,24-27,36.1-40.6.5-.6,1-1.2,1.6-1.8,1.8-1.5,3.7-1.7,5.5,0,1.7,1.6,2,3.6.5,5.5-2.1,2.7-4.5,5.2-6.8,7.9-10.1,11.4-20.2,22.8-30.4,34.2-4.3,4.8-4.3,6.4.8,10.3,5.7,4.4,11.5,8.7,17.2,13.1,6.9,5.4,7.5,13.2,1.6,19.7-1.2,1.3-2.4,2.5-3.6,3.7-2.8,3-2.5,5.5,1,7.8,6.5,4.2,12.9,8.5,19.7,12.3,6.7,3.8,9.4,9.1,9.3,16.7-.2,21.7,0,43.3-.2,65,0,6.8,2.3,11.9,7.6,16,7.4,5.9,12.5,13.5,16.9,21.8,8,14.8,12.9,30.9,18.3,46.8,2.9,8.5,5.9,17.1,8.8,25.7.3.9.7,1.7,1,2.5.3.5.7,1,1.5.9.9-.1,1.2-.8,1.1-1.6,0-1.3-.4-2.6-.4-3.9-.7-23,2.7-45.2,13.1-66,15.7-31.2,41.5-49.9,74.7-59,15.8-4.3,32-6.1,48.3-5.4,33.4,1.4,62.9,12.9,88,35,20.2,17.6,33.9,39.3,41.7,65.1M487.9,277.2c-22.3-20.6-48.6-32.5-78.7-35-17.8-1.5-35.6-.1-52.8,4.8-28.6,8.1-51.5,23.8-66.5,49.9-8.8,15.4-13.1,32.2-14.5,49.9-1.3,17.1.5,33.8,6.2,50.1,5.6,16,15.9,27.8,31,35.7,15.1,7.9,31.3,10.7,48,10.9,15.8.2,31.2-2.6,45.6-9.2,20.2-9.1,36.4-22.6,45.7-43.2,8.6-19.1,5.6-39.2-8.4-53.8-11.2-11.7-25-19.2-40.8-22.5-15.8-3.3-29.3,1.3-39.7,14.1-5.9,7.4-9.6,15.7-10.9,25.1-2.3,16,3,32.9,18.7,38.3,2.3.8,2.9,2.7,2.3,5-.7,2.4-2.6,3.1-4.8,2.6-1.5-.3-2.9-.9-4.3-1.5-9.3-4.6-15.4-12.1-18.2-21.8-5.7-19.3-1.6-37,10.6-52.8,11.6-15,27.2-20.6,45.6-17.6,20.1,3.4,36.7,13.2,50.1,28.6,5.1,5.9,8.8,12.7,10.8,20.3,4.4,16.5,1.1,31.9-7.2,46.3-12.9,22.4-32.8,36.2-56.9,44.2-16.6,5.5-33.7,7-51.1,5.1-14.6-1.6-28.5-5.4-41.5-12.3-13.5-7.3-23-18.6-31.3-31-10.4-15.4-16.8-32.6-22.9-50-6.1-17.6-11.2-35.5-18.8-52.5-4.4-9.8-9.8-19-17.8-26.4-5.6-5.2-12.2-8.3-19.8-9.2-17.9-2-34.8,10.9-41.2,25.4-5.4,12.4-2.9,24.3,8.4,31.6,3.2,2,5.9,4.6,8.7,7.3,11.4,10.8,18.5,24.4,24.8,38.4,13.3,29.7,29.8,57.2,49.6,83.1,17.3,22.5,39.1,37.9,66.2,46,22,6.5,44.4,8.5,67.2,7.4,16.3-.7,32.3-2.7,48.2-6.5,66.8-15.5,111.5-79.3,100.9-148.8-4.6-29.8-18.2-55-40.3-76.1M498,471c-15.4,15.6-33.4,27.3-54.1,34.8-1.2.4-2.3.8-3.4,1.3-.7.3-1,1-.9,1.8.2.7.7,1,1.3,1.1.9,0,1.8.1,2.7.1,11.7-.1,23.4,0,35-.4,22-.7,44-1.9,65.8-5.2,7.8-1.2,15.6-2.5,23-5.7,4.8-2.1,5.5-5.1,2.5-9.4-1-1.4-2.3-2.6-3.8-3.5-3.4-2.3-7.3-3.7-11.1-4.9-17.2-5.2-35-7.8-52.5-11.7-1.8-.3-3.1,0-4.5,1.7h0ZM63.2,293.4c1.7-3.7,3.3-7.3,5-10.7,1.3-2.7,3.4-3.6,5.7-2.6s3.1,3.4,1.9,5.9c-7.6,16.4-15.3,32.8-22.9,49.2-1.4,3.1-3.7,4-6.1,2.9-2.2-1.1-2.7-3.6-1.3-6.6,5.8-12.7,11.7-25.3,17.7-38.1h0ZM118.5,48.3c-5.8-2.3-11.4-4.5-16.9-6.7-1.6-.7-3.1-1.6-3.4-3.5-.6-3.4,2.6-5.6,6.3-4.1,4.9,1.8,9.6,3.8,14.5,5.7,11.1,4.4,22.3,8.8,33.4,13.2.5.2,1.1.5,1.6.7,2.3,1.1,3.5,2.8,2.5,5.4-1,2.6-3.2,3.1-5.6,2.3-3.8-1.3-7.6-2.9-11.4-4.4-7-2.9-13.9-5.7-21.1-8.5Z"/>
            <path className="st0" d="M251,142.3c12.4-2,24.5-4,36.6-5.9.8-.1,1.6-.3,2.4-.3,2.7-.1,4.4,1.2,4.6,3.8.2,2.5-1.3,4-3.7,4.5-6.1,1.1-12.2,2.1-18.3,3.1-7.1,1.2-14.2,2.3-21.4,3.5-.9.1-1.8.2-2.7.2-2.6,0-4.1-1.2-4.5-3.7-.3-2.5,1.2-4,3.6-4.5,1-.3,2-.4,3.3-.6h0ZM22.6,219.9c7.4-6.7,14.6-13.2,21.8-19.8.3-.2.6-.5.9-.8,2.1-1.6,4.5-1.6,6,.1,1.7,2.1,1.6,4.1-.4,6-5.1,4.8-10.3,9.5-15.5,14.2-4.1,3.8-8.2,7.5-12.4,11.2-.9.8-1.8,1.6-2.8,2.3-1.9,1.2-3.7,1-5.2-.7-1.6-1.8-1.6-3.8,0-5.5,2.3-2.4,4.9-4.6,7.5-7h0ZM37.5,85.9c-.6-1.6-1.2-3.1-1.6-4.5-.8-2.5,0-4.5,2.4-5.4,2.6-.9,4.3.3,5.3,2.7.7,1.6,1.2,3.2,1.8,4.8,3.2,8.8,6.5,17.7,9.8,26.5.9,2.4-.2,4.8-2.4,5.4-2.4.7-4.1-.2-5.2-2.5-.2-.5-.4-.9-.5-1.4-3.2-8.5-6.3-17-9.5-25.6h0ZM273.6,82c.2,2.3-1.2,3.6-2.4,4.9-6.2,7.1-12.5,14.1-18.8,21.1-2,2.3-4.6,2.7-6.4,1.1s-1.9-4.2,0-6.5c6.7-7.5,13.3-15.1,20.1-22.5,2.7-3.1,5.7-2.3,7.5,1.8h0ZM9.8,156.8h22.2c3.5,0,5.3,1.5,5.4,4,0,2.7-1.8,4.3-5.4,4.3-8.8,0-17.6,0-26.5,0S0,163.4,0,160.7c0-2.5,2-3.9,5.5-4,1.3,0,2.7,0,4.3,0h0ZM191.7,20.9c0,3.5,0,6.8,0,10.1-.1,3.2-1.6,4.8-4.3,4.8-2.6,0-3.9-1.6-3.9-5V4.9c0-3.1,1.3-4.8,3.8-4.9,2.5-.1,4.3,1.6,4.4,4.8.1,5.2,0,10.6,0,16.1ZM211.3,308.6c2.4,2.1,3.1,4.5,1.8,7.3-1.1,2.4-3.2,3.4-5.7,3.2-2.7-.1-4.5-1.8-5.3-4.3-.7-2.4,0-4.5,1.9-6,2.3-1.8,4.7-1.8,7.3-.2h0Z"/>
          </svg>
          <div style={{display:"flex", flexDirection:"column", lineHeight:1, marginTop:6}}>
            <span style={{fontSize:30, fontWeight:900, letterSpacing:"0.02em", color:"#fff", fontFamily:"'Funnel Display', Georgia, serif"}}>Spark Stock</span>
          </div>
        </div>
        <div className="header-actions" style={{display:"flex", gap:10, alignItems:"center"}}>
          {/* Sync indicator */}
          <div style={{display:"flex", alignItems:"center", gap:5, fontSize:10, color: syncing ? "#F0A500" : "#333", letterSpacing:"0.06em"}}>
            <div style={{width:6, height:6, borderRadius:"50%", background: syncing ? "#F0A500" : "#2CB67D", boxShadow: syncing ? "0 0 6px #F0A500" : "0 0 4px #2CB67D44"}} />
            {syncing ? "SYNCING..." : lastSynced ? `SYNCED ${lastSynced.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}` : ""}
          </div>
          {lowCount > 0 && (
            <div style={{background:"#FF2D2D22", border:"1px solid #FF2D2D", borderRadius:4, padding:"4px 10px", fontSize:12, color:"#FF6B6B", fontWeight:700, cursor:"pointer"}} onClick={() => setFilterStatus(filterStatus === "low" ? "all" : "low")}>
              ⚠ {lowCount} LOW / OUT
            </div>
          )}
          <button onClick={() => requireAuth(openNew)} style={{background:"#F0A500", color:"#000", border:"none", borderRadius:4, padding:"8px 16px", fontSize:12, fontWeight:700, letterSpacing:"0.08em", cursor:"pointer", textTransform:"uppercase"}}>
            + ADD ITEM
          </button>
          {/* Lock indicator */}
          <div style={{display:"flex", alignItems:"center", gap:6}}>
            <button
              onClick={() => {
                if (!hasPassword) { setSettingPassword(true); return; }
                if (unlocked) { setUnlocked(false); addToast("Editing locked."); }
                else { setAuthInput(""); setAuthError(false); setShowAuthModal(true); setPendingAction(null); }
              }}
              title={!hasPassword ? "Set a password" : unlocked ? "Lock editing" : "Unlock editing"}
              style={{background:"#222", border:"1px solid " + (unlocked ? "#2CB67D" : "#444"), borderRadius:4, padding:"8px 10px", fontSize:14, cursor:"pointer", lineHeight:1}}
            >
              {!hasPassword ? "🔓" : unlocked ? "🔓" : "🔒"}
            </button>
            <button onClick={() => requireAuth(() => { setShowSettings(true); isEditingRef.current = true; })} title="Notifications" style={{background: webhookUrl ? "#2A3A2A" : "#222", border:"1px solid " + (webhookUrl ? "#2CB67D" : "#444"), borderRadius:4, padding:"8px 10px", fontSize:15, cursor:"pointer", lineHeight:1}}>
              {webhookUrl ? "🟢" : "⚙️"}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar" style={{background:"#141414", borderBottom:"1px solid #2A2A2A", padding:"12px 16px", display:"flex", gap:12, flexWrap:"wrap", alignItems:"center"}}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items, categories, suppliers..."
          style={{background:"#222", border:"1px solid #333", borderRadius:4, padding:"7px 12px", fontSize:12, color:"#E8E0D0", width:"100%", maxWidth:280, outline:"none", fontFamily:"inherit"}}
        />
        <div className="filter-scroll" style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setFilterCat(c)} style={{
              background: filterCat === c ? "#F0A500" : "#222",
              color: filterCat === c ? "#000" : "#888",
              border: "1px solid " + (filterCat === c ? "#F0A500" : "#333"),
              borderRadius:3, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit", fontWeight: filterCat === c ? 700 : 400, letterSpacing:"0.05em"
            }}>{c}</button>
          ))}
        </div>
        <div className="sort-row" style={{display:"flex", gap:6, marginLeft:"auto", flexWrap:"wrap"}}>
          {["all","out","low","ok","good"].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} style={{
              background: filterStatus === s ? "#333" : "transparent",
              color: filterStatus === s ? "#E8E0D0" : "#555",
              border:"1px solid " + (filterStatus === s ? "#555" : "#2A2A2A"),
              borderRadius:3, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit", textTransform:"uppercase", letterSpacing:"0.06em"
            }}>{s}</button>
          ))}
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{background:"#222", color:"#888", border:"1px solid #333", borderRadius:3, padding:"4px 8px", fontSize:11, fontFamily:"inherit", marginLeft:8}}>
            <option value="name">Sort: Name</option>
            <option value="status">Sort: Status</option>
            <option value="quantity">Sort: Qty</option>
            <option value="category">Sort: Category</option>
          </select>
        </div>
      </div>

      {/* Item grid */}
      <div className="item-grid" style={{padding:"20px 24px", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))", gap:12}}>
        {filtered.length === 0 && (
          <div style={{gridColumn:"1/-1", textAlign:"center", color:"#444", padding:60, fontSize:13, letterSpacing:"0.1em"}}>NO ITEMS MATCH YOUR FILTERS</div>
        )}
        {filtered.map(item => {
          const st = STATUS(item);
          const stStyle = STATUS_STYLES[st];
          return (
            <div key={item.id} style={{background:"#1A1A1A", border:"1px solid #2A2A2A", borderLeft:`3px solid ${stStyle.bg}`, borderRadius:4, padding:16, position:"relative"}}>
              {/* Header row */}
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10}}>
                <div style={{flex:1, paddingRight:8}}>
                  <div style={{fontSize:13, fontWeight:700, color:"#E8E0D0", lineHeight:1.3}}>{item.name}</div>
                  <div style={{fontSize:10, color:"#555", marginTop:3, letterSpacing:"0.08em"}}>{item.category}</div>
                </div>
                <div style={{display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6}}>
                  <span style={{background:stStyle.bg, color:stStyle.text, fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:2, letterSpacing:"0.1em"}}>{stStyle.label}</span>
                  <div style={{display:"flex", gap:4}}>
                    <button onClick={() => requireAuth(() => openEdit(item))} style={{background:"#222", border:"1px solid #333", borderRadius:3, color:"#888", fontSize:11, cursor:"pointer", padding:"2px 7px", fontFamily:"inherit"}}>EDIT</button>
                    <button onClick={() => requireAuth(() => setConfirmDelete(item.id))} style={{background:"#222", border:"1px solid #333", borderRadius:3, color:"#555", fontSize:11, cursor:"pointer", padding:"2px 7px", fontFamily:"inherit"}}>✕</button>
                  </div>
                </div>
              </div>

              {/* Quantity row */}
              {(() => {
                const hasPending = pendingQty.hasOwnProperty(item.id);
                const displayQty = hasPending ? pendingQty[item.id] : item.quantity;
                const dispStatus = STATUS({...item, quantity: displayQty});
                const dispStyle = STATUS_STYLES[dispStatus];
                return (<>
                  <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:10}}>
                    <button className="qty-btn" onClick={() => requireAuth(() => adjustQty(item.id, item.quantity)(-1))} style={{background:"#222", border:"1px solid #333", borderRadius:3, color:"#E8E0D0", width:28, height:28, cursor:"pointer", fontSize:16, lineHeight:1, fontFamily:"inherit"}}>−</button>
                    <div style={{display:"flex", alignItems:"baseline", gap:4, flex:1, justifyContent:"center"}}>
                      <input
                        type="number"
                        value={displayQty}
                        onChange={e => requireAuth(() => setQty(item.id)(e.target.value))}
                        style={{background:"transparent", border:"none", borderBottom:`1px solid ${hasPending ? "#F0A500" : "#333"}`, color: hasPending ? "#FFD166" : "#F0A500", fontSize:24, fontWeight:700, width:70, textAlign:"center", fontFamily:"inherit", outline:"none"}}
                      />
                      <span style={{color:"#555", fontSize:11}}>{item.unit}</span>
                    </div>
                    <button className="qty-btn" onClick={() => requireAuth(() => adjustQty(item.id, item.quantity)(1))} style={{background:"#222", border:"1px solid #333", borderRadius:3, color:"#E8E0D0", width:28, height:28, cursor:"pointer", fontSize:16, lineHeight:1, fontFamily:"inherit"}}>+</button>
                  </div>

                  {/* Stock bar — reflects pending quantity */}
                  <div style={{background:"#111", borderRadius:2, height:4, marginBottom:10, overflow:"hidden"}}>
                    <div style={{background: hasPending ? dispStyle.bg : stStyle.bg, height:"100%", width:`${Math.min(100, (displayQty / (item.lowStockThreshold * 2.5)) * 100)}%`, borderRadius:2, transition:"width 0.3s"}} />
                  </div>

                  {/* Confirm / discard bar */}
                  {hasPending && (
                    <div style={{display:"flex", gap:6, marginBottom:10, alignItems:"center"}}>
                      <div style={{fontSize:10, color:"#666", flex:1}}>
                        {item.quantity} → <span style={{color:"#FFD166", fontWeight:700}}>{displayQty}</span> {item.unit}
                      </div>
                      <button onClick={() => discardQty(item.id)} style={{background:"#222", border:"1px solid #333", borderRadius:3, color:"#666", fontSize:10, cursor:"pointer", padding:"3px 9px", fontFamily:"inherit", letterSpacing:"0.06em"}}>
                        DISCARD
                      </button>
                      <button onClick={() => requireAuth(() => commitQty(item.id))} style={{background:"#2CB67D", border:"none", borderRadius:3, color:"#fff", fontSize:10, fontWeight:700, cursor:"pointer", padding:"3px 12px", fontFamily:"inherit", letterSpacing:"0.06em"}}>
                        ✓ CONFIRM
                      </button>
                    </div>
                  )}
                </>);
              })()}

              {/* Meta */}
              <div style={{fontSize:10, color:"#555", display:"flex", gap:12, flexWrap:"wrap"}}>
                <span>REORDER AT: <span style={{color:"#777"}}>{item.lowStockThreshold} {item.unit}</span></span>
                {item.supplier && <span>FROM: <span style={{color:"#777"}}>{item.supplier}</span></span>}
              </div>
              {item.notes && <div style={{fontSize:10, color:"#444", marginTop:5, fontStyle:"italic"}}>{item.notes}</div>}
              {(() => { const m = members.find(mb => mb.id === item.assignedMemberId); return m ? (
                <div style={{fontSize:9, marginTop:6, display:"flex", alignItems:"center", gap:5, flexWrap:"wrap"}}>
                  <span style={{color:"#888"}}>{m.name}:</span>
                  {m.discordId && <span style={{color:"#5865F2"}}>🔔 Discord</span>}
                  {m.email && <span style={{color:"#F0A500"}}>📧 Email</span>}
                </div>
              ) : null; })()}
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div className="footer-stats" style={{padding:"12px 16px", borderTop:"1px solid #1E1E1E", display:"flex", gap:20, fontSize:11, color:"#444"}}>
        <span>{items.length} TOTAL ITEMS</span>
        <span style={{color:"#2CB67D"}}>{items.filter(i => STATUS(i) === "good").length} GOOD</span>
        <span style={{color:"#C8A400"}}>{items.filter(i => STATUS(i) === "ok").length} OK</span>
        <span style={{color:"#FF8C00"}}>{items.filter(i => STATUS(i) === "low").length} LOW</span>
        <span style={{color:"#FF2D2D"}}>{items.filter(i => STATUS(i) === "out").length} OUT</span>
      </div>

      {/* Add/Edit Modal */}
      {showForm && form && (
        <div className="modal-wrap" style={{position:"fixed", inset:0, background:"#000000BB", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20}}>
          <div className="modal-inner" style={{background:"#1A1A1A", border:"1px solid #333", borderRadius:6, width:"100%", maxWidth:480, maxHeight:"90vh", overflowY:"auto"}}>
            <div style={{padding:"16px 20px", borderBottom:"1px solid #2A2A2A", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <span style={{fontSize:13, fontWeight:700, letterSpacing:"0.1em"}}>{editingId ? "EDIT ITEM" : "ADD NEW ITEM"}</span>
              <button onClick={closeForm} style={{background:"none", border:"none", color:"#666", cursor:"pointer", fontSize:18}}>✕</button>
            </div>
            <div style={{padding:20, display:"flex", flexDirection:"column", gap:14}}>
              {[
                ["Name *", "name", "text", "e.g. PLA Filament – Red"],
                ["Supplier", "supplier", "text", "e.g. Amazon, Home Depot"],
                ["Supplier URL / Notes", "supplierUrl", "text", "https://..."],
                ["Notes", "notes", "text", "Size, grade, color, etc."],
              ].map(([label, key, type, ph]) => (
                <label key={key} style={{fontSize:11, color:"#666", letterSpacing:"0.08em"}}>
                  {label}
                  <input
                    type={type}
                    value={form[key]}
                    onChange={e => setForm(f => ({...f, [key]: e.target.value}))}
                    placeholder={ph}
                    style={{display:"block", marginTop:5, width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"8px 10px", fontSize:12, color:"#E8E0D0", fontFamily:"inherit", outline:"none", boxSizing:"border-box"}}
                  />
                </label>
              ))}
              <label style={{fontSize:11, color:"#666", letterSpacing:"0.08em"}}>
                Category
                <select value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))} style={{display:"block", marginTop:5, width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"8px 10px", fontSize:12, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}}>
                  {CATEGORIES.filter(c => c !== "All").map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
              <div style={{display:"flex", gap:12}}>
                <label style={{fontSize:11, color:"#666", letterSpacing:"0.08em", flex:1}}>
                  Current Quantity
                  <input type="number" min="0" value={form.quantity} onChange={e => setForm(f => ({...f, quantity: parseFloat(e.target.value) || 0}))}
                    style={{display:"block", marginTop:5, width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"8px 10px", fontSize:12, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}} />
                </label>
                <label style={{fontSize:11, color:"#666", letterSpacing:"0.08em", flex:1}}>
                  Unit
                  <select value={form.unit} onChange={e => setForm(f => ({...f, unit: e.target.value}))} style={{display:"block", marginTop:5, width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"8px 10px", fontSize:12, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}}>
                    {UNIT_OPTIONS.map(u => <option key={u}>{u}</option>)}
                  </select>
                </label>
              </div>
              <label style={{fontSize:11, color:"#666", letterSpacing:"0.08em"}}>
                Low Stock Threshold (reorder when below this)
                <input type="number" min="0" value={form.lowStockThreshold} onChange={e => setForm(f => ({...f, lowStockThreshold: parseFloat(e.target.value) || 1}))}
                  style={{display:"block", marginTop:5, width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"8px 10px", fontSize:12, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}} />
              </label>
              <label style={{fontSize:11, color:"#666", letterSpacing:"0.08em"}}>
                Alert Recipient (Discord)
                {members.length === 0 ? (
                  <div style={{marginTop:5, fontSize:11, color:"#444", padding:"8px 10px", background:"#111", border:"1px solid #222", borderRadius:3}}>
                    No members added yet — add them in ⚙️ Discord Settings
                  </div>
                ) : (
                  <select value={form.assignedMemberId || ""} onChange={e => setForm(f => ({...f, assignedMemberId: e.target.value}))}
                    style={{display:"block", marginTop:5, width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"8px 10px", fontSize:12, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}}>
                    <option value="">— No one assigned —</option>
                    {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                )}
              </label>
              <div style={{display:"flex", gap:10, marginTop:4}}>
                <button onClick={saveForm} disabled={!form.name.trim()} style={{flex:1, background:"#F0A500", color:"#000", border:"none", borderRadius:4, padding:"10px", fontSize:12, fontWeight:700, letterSpacing:"0.08em", cursor:"pointer", textTransform:"uppercase", opacity: form.name.trim() ? 1 : 0.4}}>
                  {editingId ? "SAVE CHANGES" : "ADD ITEM"}
                </button>
                <button onClick={closeForm} style={{background:"#222", color:"#888", border:"1px solid #333", borderRadius:4, padding:"10px 16px", fontSize:12, cursor:"pointer", fontFamily:"inherit"}}>
                  CANCEL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <div style={{position:"fixed", inset:0, background:"#000000BB", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100}}>
          <div style={{background:"#1A1A1A", border:"1px solid #333", borderRadius:6, padding:24, maxWidth:320, textAlign:"center"}}>
            <div style={{fontSize:13, marginBottom:8, fontWeight:700}}>DELETE ITEM?</div>
            <div style={{fontSize:12, color:"#666", marginBottom:20}}>This cannot be undone.</div>
            <div style={{display:"flex", gap:10, justifyContent:"center"}}>
              <button onClick={() => deleteItem(confirmDelete)} style={{background:"#FF2D2D", color:"#fff", border:"none", borderRadius:4, padding:"8px 20px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit"}}>DELETE</button>
              <button onClick={() => setConfirmDelete(null)} style={{background:"#222", color:"#888", border:"1px solid #333", borderRadius:4, padding:"8px 20px", fontSize:12, cursor:"pointer", fontFamily:"inherit"}}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* Discord Settings Modal */}
      {showSettings && (
        <div className="modal-wrap" style={{position:"fixed", inset:0, background:"#000000BB", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20}}>
          <div className="modal-inner" style={{background:"#1A1A1A", border:"1px solid #333", borderRadius:6, width:"100%", maxWidth:480, maxHeight:"90vh", overflowY:"auto"}}>
            <div style={{padding:"16px 20px", borderBottom:"1px solid #2A2A2A", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
              <div>
                <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", width:"100%"}}>
                  <div>
                    <span style={{fontSize:13, fontWeight:700, letterSpacing:"0.1em"}}>NOTIFICATIONS & SETTINGS</span>
                    <div style={{fontSize:10, color:"#555", marginTop:3}}>Discord & email alerts — fire automatically when stock drops low or runs out</div>
                  </div>
                  <button onClick={() => { setShowSettings(false); isEditingRef.current = false; setSettingPassword(true); }} style={{fontSize:10, color:"#555", background:"none", border:"1px solid #333", borderRadius:3, padding:"4px 8px", cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap"}}>🔑 Password</button>
                </div>
              </div>
              <button onClick={() => { setShowSettings(false); isEditingRef.current = false; }} style={{background:"none", border:"none", color:"#666", cursor:"pointer", fontSize:18}}>✕</button>
            </div>
            <div style={{padding:20, display:"flex", flexDirection:"column", gap:14}}>
              <div style={{background:"#111", border:"1px solid #2A2A2A", borderRadius:4, padding:12, fontSize:11, color:"#666", lineHeight:1.7}}>
                <div style={{color:"#888", fontWeight:700, marginBottom:6}}>HOW TO GET YOUR WEBHOOK URL:</div>
                1. Open Discord → go to your channel<br/>
                2. Click ⚙️ Edit Channel → Integrations → Webhooks<br/>
                3. Click "New Webhook" → Copy Webhook URL<br/>
                4. Paste it below
              </div>
              <label style={{fontSize:11, color:"#666", letterSpacing:"0.08em"}}>
                Webhook URL
                <input
                  type="text"
                  value={webhookInput}
                  onChange={e => setWebhookInput(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  style={{display:"block", marginTop:5, width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"8px 10px", fontSize:12, color:"#E8E0D0", fontFamily:"inherit", outline:"none", boxSizing:"border-box"}}
                />
              </label>
              {webhookUrl && (
                <div style={{fontSize:11, color:"#2CB67D", display:"flex", alignItems:"center", gap:6}}>
                  <span>●</span> Webhook active — alerts will fire when items drop to LOW or OUT
                </div>
              )}
              <div style={{display:"flex", gap:10}}>
                <button onClick={saveWebhook} disabled={!webhookInput.trim()} style={{flex:1, background:"#5865F2", color:"#fff", border:"none", borderRadius:4, padding:"10px", fontSize:12, fontWeight:700, letterSpacing:"0.08em", cursor:"pointer", textTransform:"uppercase", opacity: webhookInput.trim() ? 1 : 0.4}}>
                  SAVE WEBHOOK
                </button>
                {webhookUrl && (
                  <button onClick={async () => { await storageSave("discord_webhook", ""); setWebhookUrl(""); setWebhookInput(""); addToast("Webhook removed."); }} style={{background:"#222", color:"#888", border:"1px solid #333", borderRadius:4, padding:"10px 14px", fontSize:11, cursor:"pointer", fontFamily:"inherit"}}>
                    REMOVE
                  </button>
                )}
              </div>

              {/* EmailJS config */}
              <div style={{borderTop:"1px solid #2A2A2A", paddingTop:14, marginTop:2}}>
                <div style={{fontSize:11, fontWeight:700, color:"#888", letterSpacing:"0.1em", marginBottom:6}}>EMAIL NOTIFICATIONS <span style={{fontSize:9, color:"#555", fontWeight:400}}>(via EmailJS)</span></div>
                <div style={{fontSize:10, color:"#555", marginBottom:10, lineHeight:1.7}}>
                  <strong style={{color:"#666"}}>Setup:</strong> Create a free account at <span style={{color:"#F0A500"}}>emailjs.com</span>, add an Email Service and a Template, then paste your credentials below.<br/>
                  In your EmailJS template use variables: <span style={{color:"#666"}}>{"{{to_name}}"}, {"{{item_name}}"}, {"{{status}}"}, {"{{current_qty}}"}, {"{{supplier}}"}, {"{{app_url}}"}</span>
                </div>
                <div style={{display:"flex", flexDirection:"column", gap:6}}>
                  {[["Service ID", "serviceId"], ["Template ID", "templateId"], ["Public Key", "publicKey"]].map(([label, key]) => (
                    <div key={key} style={{display:"flex", gap:6, alignItems:"center"}}>
                      <span style={{fontSize:10, color:"#555", width:90, flexShrink:0}}>{label}</span>
                      <input
                        placeholder={`EmailJS ${label}`}
                        value={emailjsInput[key] || ""}
                        onChange={e => setEmailjsInput(f => ({...f, [key]: e.target.value}))}
                        style={{flex:1, background:"#111", border:"1px solid #F0A50044", borderRadius:3, padding:"6px 9px", fontSize:11, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}}
                      />
                    </div>
                  ))}
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:4}}>
                    {emailjsServiceId && <span style={{fontSize:10, color:"#F0A500"}}>● Email active</span>}
                    {!emailjsServiceId && <span/>}
                    <div style={{display:"flex", gap:6}}>
                      {emailjsServiceId && (
                        <button onClick={async () => { await storageSave("emailjs_config", JSON.stringify({serviceId:"",templateId:"",publicKey:""})); setEmailjsServiceId(""); setEmailjsTemplateId(""); setEmailjsPublicKey(""); setEmailjsInput({serviceId:"",templateId:"",publicKey:""}); addToast("EmailJS config removed."); }} style={{background:"#222", color:"#888", border:"1px solid #333", borderRadius:3, padding:"6px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit"}}>REMOVE</button>
                      )}
                      <button onClick={saveEmailjsConfig} disabled={!emailjsInput.serviceId?.trim() || !emailjsInput.templateId?.trim() || !emailjsInput.publicKey?.trim()} style={{background:"#F0A500", color:"#000", border:"none", borderRadius:3, padding:"6px 14px", fontSize:11, fontWeight:700, cursor:"pointer", opacity: (emailjsInput.serviceId?.trim() && emailjsInput.templateId?.trim() && emailjsInput.publicKey?.trim()) ? 1 : 0.4}}>
                        SAVE
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Member management */}
              <div style={{borderTop:"1px solid #2A2A2A", paddingTop:14, marginTop:2}}>
                <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6}}>
                  <div style={{fontSize:11, fontWeight:700, color:"#888", letterSpacing:"0.1em"}}>TEAM MEMBERS</div>
                  <button
                    onClick={async () => { await sendWeeklyDigests(); }}
                    title="Send Monday digest now (for testing)"
                    style={{fontSize:10, color:"#555", background:"none", border:"1px solid #333", borderRadius:3, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit"}}
                  >
                    ▶ Send Digest Now
                  </button>
                </div>
                <div style={{fontSize:10, color:"#555", marginBottom:10, lineHeight:1.6}}>
                  Add members with a Discord User ID, email address, or both — alerts fire on all configured channels.
                </div>
                {/* Existing members */}
                {members.length > 0 && (
                  <div style={{display:"flex", flexDirection:"column", gap:6, marginBottom:10}}>
                    {members.map(m => (
                      <div key={m.id} style={{display:"flex", alignItems:"center", justifyContent:"space-between", background:"#111", border:"1px solid #222", borderRadius:3, padding:"7px 10px"}}>
                        <div style={{flex:1}}>
                          <span style={{fontSize:12, color:"#E8E0D0"}}>{m.name}</span>
                          <div style={{display:"flex", gap:8, marginTop:3, flexWrap:"wrap"}}>
                            {m.discordId && <span style={{fontSize:9, color:"#5865F2", background:"#5865F211", border:"1px solid #5865F244", borderRadius:2, padding:"1px 5px"}}>Discord: {m.discordId}</span>}
                            {m.email && <span style={{fontSize:9, color:"#F0A500", background:"#F0A50011", border:"1px solid #F0A50044", borderRadius:2, padding:"1px 5px"}}>Email: {m.email}</span>}
                          </div>
                        </div>
                        <button onClick={() => deleteMember(m.id)} style={{background:"none", border:"none", color:"#555", cursor:"pointer", fontSize:13, padding:"0 4px"}}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Add member form */}
                <div style={{display:"flex", flexDirection:"column", gap:6}}>
                  <div style={{display:"flex", gap:6}}>
                    <input
                      placeholder="Name (e.g. Alex) *"
                      value={memberForm.name}
                      onChange={e => setMemberForm(f => ({...f, name: e.target.value}))}
                      style={{flex:1, background:"#111", border:"1px solid #333", borderRadius:3, padding:"7px 9px", fontSize:11, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}}
                    />
                  </div>
                  <div style={{display:"flex", gap:6}}>
                    <input
                      placeholder="Discord User ID (optional)"
                      value={memberForm.discordId}
                      onChange={e => setMemberForm(f => ({...f, discordId: e.target.value}))}
                      style={{flex:1, background:"#111", border:"1px solid #5865F244", borderRadius:3, padding:"7px 9px", fontSize:11, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}}
                    />
                    <input
                      placeholder="Email address (optional)"
                      value={memberForm.email}
                      onChange={e => setMemberForm(f => ({...f, email: e.target.value}))}
                      style={{flex:1, background:"#111", border:"1px solid #F0A50044", borderRadius:3, padding:"7px 9px", fontSize:11, color:"#E8E0D0", fontFamily:"inherit", outline:"none"}}
                    />
                  </div>
                  <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
                    <span style={{fontSize:9, color:"#444"}}>At least one of Discord ID or Email is required.</span>
                    <button onClick={saveMember} disabled={!memberForm.name.trim() || (!memberForm.discordId.trim() && !memberForm.email.trim())} style={{background:"#5865F2", color:"#fff", border:"none", borderRadius:3, padding:"7px 16px", fontSize:11, fontWeight:700, cursor:"pointer", opacity: (memberForm.name.trim() && (memberForm.discordId.trim() || memberForm.email.trim())) ? 1 : 0.4}}>
                      ADD MEMBER
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auth modal */}
      {showAuthModal && (
        <div style={{position:"fixed", inset:0, background:"#000000CC", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:20}}>
          <div style={{background:"#1A1A1A", border:"1px solid #333", borderRadius:6, width:"100%", maxWidth:360, padding:24}}>
            <div style={{fontSize:13, fontWeight:700, letterSpacing:"0.1em", marginBottom:6}}>🔒 UNLOCK EDITING</div>
            <div style={{fontSize:11, color:"#555", marginBottom:16}}>Enter your password to make changes.</div>
            <input
              autoFocus
              type="password"
              value={authInput}
              onChange={e => { setAuthInput(e.target.value); setAuthError(false); }}
              onKeyDown={e => e.key === "Enter" && submitAuth()}
              placeholder="Password"
              style={{display:"block", width:"100%", background:"#111", border:`1px solid ${authError ? "#FF2D2D" : "#333"}`, borderRadius:3, padding:"9px 12px", fontSize:13, color:"#E8E0D0", fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginBottom:8}}
            />
            {authError && <div style={{fontSize:11, color:"#FF6B6B", marginBottom:10}}>Incorrect password. Try again.</div>}
            <div style={{display:"flex", gap:8, marginTop:4}}>
              <button onClick={submitAuth} style={{flex:1, background:"#F0A500", color:"#000", border:"none", borderRadius:4, padding:"9px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit"}}>UNLOCK</button>
              <button onClick={() => { setShowAuthModal(false); setPendingAction(null); }} style={{background:"#222", color:"#888", border:"1px solid #333", borderRadius:4, padding:"9px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit"}}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* Set password modal */}
      {settingPassword && (
        <div style={{position:"fixed", inset:0, background:"#000000CC", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:20}}>
          <div style={{background:"#1A1A1A", border:"1px solid #333", borderRadius:6, width:"100%", maxWidth:360, padding:24}}>
            <div style={{fontSize:13, fontWeight:700, letterSpacing:"0.1em", marginBottom:6}}>{hasPassword ? "CHANGE PASSWORD" : "SET A PASSWORD"}</div>
            <div style={{fontSize:11, color:"#555", marginBottom:16}}>This password will be required to edit inventory.</div>
            <input
              autoFocus
              type="password"
              value={newPasswordInput}
              onChange={e => { setNewPasswordInput(e.target.value); setPasswordError(""); }}
              placeholder="New password"
              style={{display:"block", width:"100%", background:"#111", border:"1px solid #333", borderRadius:3, padding:"9px 12px", fontSize:13, color:"#E8E0D0", fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginBottom:8}}
            />
            <input
              type="password"
              value={newPasswordConfirm}
              onChange={e => { setNewPasswordConfirm(e.target.value); setPasswordError(""); }}
              onKeyDown={e => e.key === "Enter" && savePassword()}
              placeholder="Confirm password"
              style={{display:"block", width:"100%", background:"#111", border:`1px solid ${passwordError ? "#FF2D2D" : "#333"}`, borderRadius:3, padding:"9px 12px", fontSize:13, color:"#E8E0D0", fontFamily:"inherit", outline:"none", boxSizing:"border-box", marginBottom:8}}
            />
            {passwordError && <div style={{fontSize:11, color:"#FF6B6B", marginBottom:8}}>{passwordError}</div>}
            <div style={{display:"flex", gap:8, marginTop:4}}>
              <button onClick={savePassword} style={{flex:1, background:"#F0A500", color:"#000", border:"none", borderRadius:4, padding:"9px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit"}}>SAVE PASSWORD</button>
              <button onClick={() => { setSettingPassword(false); setNewPasswordInput(""); setNewPasswordConfirm(""); setPasswordError(""); }} style={{background:"#222", color:"#888", border:"1px solid #333", borderRadius:4, padding:"9px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit"}}>CANCEL</button>
            </div>
            {hasPassword && (
              <button onClick={() => { removePassword(); setSettingPassword(false); }} style={{marginTop:10, width:"100%", background:"none", border:"none", color:"#444", fontSize:11, cursor:"pointer", fontFamily:"inherit"}}>Remove password protection</button>
            )}
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div style={{position:"fixed", bottom:20, right:20, display:"flex", flexDirection:"column", gap:8, zIndex:200}}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === "discord" ? "#5865F2" : t.type === "email" ? "#F0A500" : t.type === "error" ? "#FF2D2D" : "#2CB67D",
            color:"#fff", borderRadius:4, padding:"10px 14px", fontSize:11, fontFamily:"'Courier New', monospace",
            fontWeight:700, letterSpacing:"0.05em", boxShadow:"0 4px 16px #0008",
            animation:"slideIn 0.2s ease"
          }}>
            {t.type === "discord" ? "🔔 " : t.type === "email" ? "📧 " : t.type === "error" ? "✕ " : "✓ "}{t.msg}
          </div>
        ))}
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Funnel+Display:wght@700;800;900&display=swap');
        @keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
        input[type=number] { -moz-appearance: textfield; }
        @media (max-width: 600px) {
          .filter-bar { flex-direction: column !important; align-items: stretch !important; }
          .filter-bar input { width: 100% !important; }
          .filter-scroll { overflow-x: auto; padding-bottom: 4px; flex-wrap: nowrap !important; }
          .filter-scroll::-webkit-scrollbar { height: 2px; }
          .filter-scroll::-webkit-scrollbar-thumb { background: #333; }
          .sort-row { margin-left: 0 !important; }
          .item-grid { grid-template-columns: 1fr !important; padding: 12px !important; }
          .top-bar { padding: 12px !important; }
          .footer-stats { flex-wrap: wrap; gap: 10px !important; }
          .modal-inner { margin: 0 !important; border-radius: 0 !important; max-height: 100vh !important; height: 100vh; }
          .modal-wrap { align-items: flex-end !important; padding: 0 !important; }
          .qty-btn { width: 44px !important; height: 44px !important; font-size: 20px !important; }
          .logo-svg { height: 26px !important; }
          .header-actions { flex-wrap: wrap; }
        }
      `}</style>
    </div>
  );
}
