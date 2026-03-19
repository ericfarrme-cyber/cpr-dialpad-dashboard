'use client';

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);
var ROLES = [
  { id: "admin", label: "Admin", color: "#FF2D95", desc: "Full access — manage users, all data, system settings" },
  { id: "manager", label: "Manager", color: "#7B2FFF", desc: "Full dashboard access — audit, grade, view all employees" },
  { id: "employee", label: "Employee", color: "#00D4FF", desc: "Limited view — own scores, schedule, store stats only" },
];

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background:"#1A1D23",borderRadius:12,padding:"18px 20px",borderLeft:"3px solid "+accent,minWidth:0 }}>
      <div style={{ color:"#8B8F98",fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em" }}>{label}</div>
      <div style={{ color:"#F0F1F3",fontSize:28,fontWeight:700,marginTop:4 }}>{value}</div>
      {sub && <div style={{ color:"#6B6F78",fontSize:12,marginTop:2 }}>{sub}</div>}
    </div>
  );
}

export default function AdminTab({ onPreview }) {
  var auth = useAuth();
  var [users, setUsers] = useState([]);
  var [loading, setLoading] = useState(true);
  var [showAdd, setShowAdd] = useState(false);
  var [editingUser, setEditingUser] = useState(null);
  var [form, setForm] = useState({ email: "", name: "", role: "employee", store: "" });
  var [actionMsg, setActionMsg] = useState(null);
  var [saving, setSaving] = useState(false);

  var loadUsers = async function() {
    setLoading(true);
    try {
      var res = await fetch("/api/auth/users", {
        headers: { "Authorization": "Bearer " + auth.accessToken },
      });
      var json = await res.json();
      if (json.success) setUsers(json.users || []);
      else setActionMsg({ type: "error", text: json.error || "Failed to load users" });
    } catch(e) {
      setActionMsg({ type: "error", text: "Failed to load users" });
    }
    setLoading(false);
  };

  useEffect(function() { if (auth && auth.accessToken) loadUsers(); }, [auth]);

  var handleAdd = async function() {
    if (!form.email) { setActionMsg({ type: "error", text: "Email is required" }); return; }
    setSaving(true);
    try {
      var res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + auth.accessToken },
        body: JSON.stringify({ action: "add", email: form.email.toLowerCase().trim(), name: form.name, role: form.role, store: form.store }),
      });
      var json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: "User added: " + form.email });
        setForm({ email: "", name: "", role: "employee", store: "" });
        setShowAdd(false);
        loadUsers();
      } else {
        setActionMsg({ type: "error", text: json.error });
      }
    } catch(e) {
      setActionMsg({ type: "error", text: "Failed to add user" });
    }
    setSaving(false);
  };

  var handleUpdate = async function(userId, updates) {
    try {
      var res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + auth.accessToken },
        body: JSON.stringify(Object.assign({ action: "update", id: userId }, updates)),
      });
      var json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: "User updated" });
        setEditingUser(null);
        loadUsers();
      } else {
        setActionMsg({ type: "error", text: json.error });
      }
    } catch(e) {
      setActionMsg({ type: "error", text: "Failed to update user" });
    }
  };

  var handleDeactivate = async function(userId, name) {
    if (!confirm('Deactivate access for "' + name + '"? They will no longer be able to log in.')) return;
    try {
      var res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + auth.accessToken },
        body: JSON.stringify({ action: "remove", id: userId }),
      });
      var json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: "Access revoked for " + name });
        loadUsers();
      } else {
        setActionMsg({ type: "error", text: json.error });
      }
    } catch(e) {
      setActionMsg({ type: "error", text: "Failed to deactivate user" });
    }
  };

  var handleReactivate = async function(userId) {
    handleUpdate(userId, { active: true });
  };

  // Access check
  if (!auth || auth.role !== "admin") {
    return (
      <div style={{ padding:40,textAlign:"center" }}>
        <div style={{ fontSize:48,marginBottom:16 }}>{"\uD83D\uDD12"}</div>
        <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>Admin Access Required</div>
        <div style={{ color:"#6B6F78",fontSize:13,marginTop:8 }}>Only administrators can manage dashboard users.</div>
      </div>
    );
  }

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading users...</div>;

  var activeUsers = users.filter(function(u) { return u.active; });
  var inactiveUsers = users.filter(function(u) { return !u.active; });
  var adminCount = activeUsers.filter(function(u) { return u.role === "admin"; }).length;
  var managerCount = activeUsers.filter(function(u) { return u.role === "manager"; }).length;
  var empCount = activeUsers.filter(function(u) { return u.role === "employee"; }).length;

  return (
    <div>
      {/* Stats */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24 }}>
        <StatCard label="Total Active Users" value={activeUsers.length} accent="#7B2FFF" />
        <StatCard label="Admins" value={adminCount} accent="#FF2D95" />
        <StatCard label="Managers" value={managerCount} accent="#7B2FFF" />
        <StatCard label="Employees" value={empCount} accent="#00D4FF" />
      </div>

      {/* Action bar */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>Dashboard Users</div>
        <button onClick={function(){setShowAdd(!showAdd); setForm({ email:"", name:"", role:"employee", store:"" });}}
          style={{ padding:"8px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>
          {showAdd ? "Cancel" : "+ Add User"}
        </button>
      </div>

      {/* Status messages */}
      {actionMsg && (
        <div onClick={function(){setActionMsg(null);}}
          style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,cursor:"pointer",background:actionMsg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(actionMsg.type==="success"?"#4ADE8033":"#F8717133"),color:actionMsg.type==="success"?"#4ADE80":"#F87171",fontSize:13 }}>
          {actionMsg.text}
        </div>
      )}

      {/* Add user form */}
      {showAdd && (
        <div style={{ background:"#1A1D23",borderRadius:12,padding:24,marginBottom:20,border:"1px solid #7B2FFF33" }}>
          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:16 }}>Add New User</div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16 }}>
            <div>
              <label style={{ color:"#8B8F98",fontSize:11,display:"block",marginBottom:4 }}>Email *</label>
              <input type="email" value={form.email} onChange={function(e){setForm(Object.assign({},form,{email:e.target.value}));}}
                placeholder="user@gmail.com"
                style={{ width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ color:"#8B8F98",fontSize:11,display:"block",marginBottom:4 }}>Full Name</label>
              <input type="text" value={form.name} onChange={function(e){setForm(Object.assign({},form,{name:e.target.value}));}}
                placeholder="John Smith"
                style={{ width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
            </div>
            <div>
              <label style={{ color:"#8B8F98",fontSize:11,display:"block",marginBottom:4 }}>Role *</label>
              <select value={form.role} onChange={function(e){setForm(Object.assign({},form,{role:e.target.value}));}}
                style={{ width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }}>
                {ROLES.map(function(r) { return <option key={r.id} value={r.id}>{r.label + " — " + r.desc}</option>; })}
              </select>
            </div>
            <div>
              <label style={{ color:"#8B8F98",fontSize:11,display:"block",marginBottom:4 }}>Primary Store</label>
              <select value={form.store} onChange={function(e){setForm(Object.assign({},form,{store:e.target.value}));}}
                style={{ width:"100%",padding:"10px 12px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }}>
                <option value="">All Stores</option>
                {STORE_KEYS.map(function(k) { return <option key={k} value={k}>{STORES[k].name}</option>; })}
              </select>
            </div>
          </div>

          {/* Role descriptions */}
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16 }}>
            {ROLES.map(function(r) {
              var isSelected = form.role === r.id;
              return (
                <div key={r.id} onClick={function(){setForm(Object.assign({},form,{role:r.id}));}}
                  style={{ padding:12,borderRadius:8,border:"1px solid "+(isSelected?r.color+"55":"#2A2D35"),background:isSelected?r.color+"08":"#12141A",cursor:"pointer" }}>
                  <div style={{ color:r.color,fontSize:12,fontWeight:700,marginBottom:4 }}>{r.label}</div>
                  <div style={{ color:"#6B6F78",fontSize:10,lineHeight:1.3 }}>{r.desc}</div>
                </div>
              );
            })}
          </div>

          <button onClick={handleAdd} disabled={saving}
            style={{ padding:"10px 24px",borderRadius:8,border:"none",background:saving?"#6B6F78":"#7B2FFF",color:"#FFF",fontSize:13,fontWeight:700,cursor:saving?"wait":"pointer" }}>
            {saving ? "Adding..." : "Add User"}
          </button>
        </div>
      )}

      {/* User list */}
      <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
        {activeUsers.map(function(u) {
          var roleInfo = ROLES.find(function(r) { return r.id === u.role; }) || ROLES[2];
          var store = STORES[u.store];
          var isEditing = editingUser === u.id;
          var isCurrentUser = auth.user && auth.user.email === u.email;

          return (
            <div key={u.id} style={{ padding:"16px 20px",borderBottom:"1px solid #1E2028" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                  <div style={{ width:36,height:36,borderRadius:10,background:roleInfo.color+"18",display:"flex",alignItems:"center",justifyContent:"center",color:roleInfo.color,fontSize:14,fontWeight:800 }}>
                    {(u.name || u.email || "?").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <span style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{u.name || u.email}</span>
                      <span style={{ padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,background:roleInfo.color+"18",color:roleInfo.color }}>{roleInfo.label}</span>
                      {store && <span style={{ color:store.color,fontSize:10 }}>{store.name.replace("CPR ","")}</span>}
                      {isCurrentUser && <span style={{ padding:"2px 6px",borderRadius:4,fontSize:8,fontWeight:600,background:"#4ADE8018",color:"#4ADE80" }}>YOU</span>}
                    </div>
                    <div style={{ color:"#6B6F78",fontSize:11,marginTop:2 }}>{u.email}</div>
                  </div>
                </div>
                <div style={{ display:"flex",gap:6 }}>
                  {onPreview && (
                    <button onClick={function(){onPreview(u.role, u.name, u.store);}}
                      style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #7B2FFF22",background:"transparent",color:"#7B2FFF",fontSize:10,cursor:"pointer" }}>
                      Preview
                    </button>
                  )}
                  {!isCurrentUser && (
                    <button onClick={function(){setEditingUser(isEditing ? null : u.id);}}
                      style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:10,cursor:"pointer" }}>
                      {isEditing ? "Cancel" : "Edit"}
                    </button>
                  )}
                  {!isCurrentUser && (
                    <button onClick={function(){handleDeactivate(u.id, u.name || u.email);}}
                      style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>
                      Revoke
                    </button>
                  )}
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div style={{ marginTop:12,padding:16,background:"#12141A",borderRadius:8 }}>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10 }}>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Name</label>
                      <input type="text" defaultValue={u.name}
                        id={"edit-name-"+u.id}
                        style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#1A1D23",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} />
                    </div>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Email</label>
                      <input type="email" defaultValue={u.email}
                        id={"edit-email-"+u.id}
                        style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#1A1D23",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} />
                    </div>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Role</label>
                      <select defaultValue={u.role} id={"edit-role-"+u.id}
                        style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#1A1D23",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }}>
                        {ROLES.map(function(r) { return <option key={r.id} value={r.id}>{r.label}</option>; })}
                      </select>
                    </div>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Store</label>
                      <select defaultValue={u.store} id={"edit-store-"+u.id}
                        style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#1A1D23",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }}>
                        <option value="">All Stores</option>
                        {STORE_KEYS.map(function(k) { return <option key={k} value={k}>{STORES[k].name}</option>; })}
                      </select>
                    </div>
                  </div>
                  <button onClick={function(){
                    var name = document.getElementById("edit-name-"+u.id).value;
                    var email = document.getElementById("edit-email-"+u.id).value.toLowerCase().trim();
                    var role = document.getElementById("edit-role-"+u.id).value;
                    var store = document.getElementById("edit-store-"+u.id).value;
                    handleUpdate(u.id, { name: name, email: email, role: role, store: store });
                  }}
                    style={{ marginTop:10,padding:"7px 18px",borderRadius:6,border:"none",background:"#7B2FFF",color:"#FFF",fontSize:11,fontWeight:700,cursor:"pointer" }}>
                    Save Changes
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {activeUsers.length === 0 && (
          <div style={{ padding:40,textAlign:"center",color:"#6B6F78",fontSize:13 }}>No users configured.</div>
        )}
      </div>

      {/* Inactive users */}
      {inactiveUsers.length > 0 && (
        <div style={{ marginTop:24 }}>
          <div style={{ color:"#6B6F78",fontSize:13,fontWeight:700,marginBottom:8 }}>Deactivated Users ({inactiveUsers.length})</div>
          <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden",opacity:0.6 }}>
            {inactiveUsers.map(function(u) {
              return (
                <div key={u.id} style={{ padding:"12px 20px",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div>
                    <span style={{ color:"#8B8F98",fontSize:13 }}>{u.name || u.email}</span>
                    <span style={{ color:"#6B6F78",fontSize:11,marginLeft:8 }}>{u.email}</span>
                    <span style={{ color:"#F87171",fontSize:9,marginLeft:8 }}>DEACTIVATED</span>
                  </div>
                  <button onClick={function(){handleReactivate(u.id);}}
                    style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #4ADE8033",background:"transparent",color:"#4ADE80",fontSize:10,cursor:"pointer" }}>
                    Reactivate
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
