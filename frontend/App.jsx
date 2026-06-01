import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

const API_URL = 'http://localhost:8000/api/v1';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem('refreshToken') || '');
  const [userRole, setUserRole] = useState('user');
  const [viewScope, setViewScope] = useState('user');
  
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleInput, setRoleInput] = useState('user');
  
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState({ text: '', isError: false });

  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const parseJwtRole = (jwtToken) => {
    try {
      const base64Url = jwtToken.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(window.atob(base64)).role || 'user';
    } catch (e) { return 'user'; }
  };

  useEffect(() => {
    if (token) {
      const detectedRole = parseJwtRole(token);
      setUserRole(detectedRole);
      setViewScope(detectedRole);
    }
  }, [token]);

  useEffect(() => {
    if (token) fetchTasks();
  }, [token, viewScope]);

  const showMsg = (text, isError = false) => {
    setMessage({ text, isError });
    setTimeout(() => setMessage({ text: '', isError: false }), 4000);
  };

  const authenticatedFetch = async (url, options = {}) => {
    if (!options.headers) options.headers = {};
    options.headers['Authorization'] = `Bearer ${token}`;

    let response = await fetch(url, options);

    if (response.status === 401 && refreshToken) {
      const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });

      if (refreshResponse.ok) {
        const credentials = await refreshResponse.json();
        localStorage.setItem('token', credentials.access_token);
        localStorage.setItem('refreshToken', credentials.refresh_token);
        setToken(credentials.access_token);
        setRefreshToken(credentials.refresh_token);

        options.headers['Authorization'] = `Bearer ${credentials.access_token}`;
        response = await fetch(url, options);
      } else {
        handleLogout();
        showMsg("Session expired. Please log in again.", true);
      }
    }
    return response;
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    const endpoint = isRegister ? '/auth/register' : '/auth/login';
    try {
      if (isRegister) {
        const res = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, role: roleInput }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Registration failed');
        showMsg('Registered successfully! Please log in.');
        setIsRegister(false);
      } else {
        const formData = new URLSearchParams();
        formData.append('username', email);
        formData.append('password', password);

        const res = await fetch(`${API_URL}${endpoint}`, { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Authentication rejected');
        
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('refreshToken', data.refresh_token);
        setToken(data.access_token);
        setRefreshToken(data.refresh_token);
        showMsg('Session authenticated successfully!');
      }
    } catch (err) { showMsg(err.message, true); }
  };

  const fetchTasks = async () => {
    const endpoint = viewScope === 'admin' ? '/admin/tasks' : '/tasks';
    try {
      const res = await authenticatedFetch(`${API_URL}${endpoint}`);
      const data = await res.json();
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) { showMsg('Failed to sync framework tasks', true); }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      const res = await authenticatedFetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      });
      if (!res.ok) throw new Error('Could not add new task target');
      setTitle(''); 
      setDescription(''); 
      showMsg('Task appended!');
      fetchTasks();
    } catch (err) { showMsg(err.message, true); }
  };

  const handleSaveUpdate = async (task, forcedFields = {}) => {
    const payload = {
      title: task.title,
      description: task.description,
      is_completed: task.is_completed,
      ...forcedFields
    };
    try {
      const res = await authenticatedFetch(`${API_URL}/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Database rejection on update execution');
      setEditingTaskId(null);
      showMsg('Task modified successfully.');
      fetchTasks();
    } catch (err) { showMsg(err.message, true); }
  };

  const startEditing = (task) => {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditDesc(task.description || '');
  };

  const handleDeleteTask = async (id) => {
    try {
      const res = await authenticatedFetch(`${API_URL}/tasks/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Task elimination failure');
      showMsg('Task record successfully removed.');
      fetchTasks();
    } catch (err) { showMsg(err.message, true); }
  };

  const handleLogout = () => {
    localStorage.clear();
    setToken(''); setRefreshToken(''); setUserRole('user'); setViewScope('user'); setTasks([]);
    showMsg('Logged out successfully.');
  };

  const formatDate = (isoString) => {
    return new Date(isoString).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <header className="flex justify-between items-center mb-8 pb-4 border-b border-gray-800">
        <h1 className="text-2xl font-bold tracking-tight text-white">Dashboard Portal</h1>
        {token && (
          <div className="flex items-center gap-4">
            {userRole === 'admin' && (
              <select value={viewScope} onChange={(e) => setViewScope(e.target.value)} className="bg-gray-800 text-sm rounded border border-gray-700 p-1 text-gray-300 focus:outline-none">
                <option value="user">User Viewport</option>
                <option value="admin">Admin Viewport</option>
              </select>
            )}
            <button onClick={handleLogout} className="text-sm bg-red-900/40 text-red-400 border border-red-800 px-3 py-1 rounded hover:bg-red-900/60 transition">Logout</button>
          </div>
        )}
      </header>

      {message.text && (
        <div className={`p-3 mb-4 rounded border text-sm transition-all ${message.isError ? 'bg-red-950 border-red-800 text-red-200' : 'bg-emerald-950 border-emerald-800 text-emerald-200'}`}>
          {message.text}
        </div>
      )}

      {!token ? (
        <div className="max-w-md mx-auto bg-gray-800/50 border border-gray-800 p-6 rounded-lg shadow-xl">
          <h2 className="text-xl font-semibold mb-4 text-white">{isRegister ? 'Create Account' : 'Sign In'}</h2>
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:outline-none" />
            <input type="password" placeholder="Password" required value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white focus:outline-none" />
            {isRegister && (
              <select value={roleInput} onChange={e => setRoleInput(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white">
                <option value="user">Regular User</option>
                <option value="admin">Administrator</option>
              </select>
            )}
            <button type="submit" className="w-full bg-blue-600 p-2 rounded text-white font-medium hover:bg-blue-700 transition">{isRegister ? 'Register' : 'Login'}</button>
          </form>
          <button onClick={() => setIsRegister(!isRegister)} className="text-xs text-blue-400 mt-4 block mx-auto hover:underline">{isRegister ? 'Login here' : 'Register here'}</button>
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-1 bg-gray-800/30 border border-gray-800 p-4 rounded-lg h-fit">
            <h2 className="text-lg font-semibold mb-3 text-white">Create New Task</h2>
            <form onSubmit={handleCreateTask} className="space-y-3">
              <input type="text" placeholder="Title" required value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white focus:outline-none" />
              <textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-sm text-white h-20 focus:outline-none" />
              <button type="submit" className="w-full bg-emerald-600 text-white text-sm p-2 rounded hover:bg-emerald-700 transition font-medium">Add Task</button>
            </form>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h2 className="text-lg font-semibold text-white">System Dashboard Tasks</h2>
            {tasks.length === 0 ? (
              <p className="text-sm text-gray-500 bg-gray-800/10 border border-gray-800/50 rounded-lg p-6 text-center">No structural tasks discovered.</p>
            ) : (
              tasks.map(t => (
                <div key={t.id} className="p-4 bg-gray-800/40 border border-gray-800 rounded-lg flex justify-between items-center transition-all">
                  {editingTaskId === t.id ? (
                    <div className="flex-1 space-y-2 mr-4">
                      <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} className="w-full bg-gray-900 border border-gray-700 text-sm rounded p-1 text-white focus:outline-none focus:border-blue-500" />
                      <input type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)} className="w-full bg-gray-900 border border-gray-700 text-xs rounded p-1 text-gray-300 focus:outline-none focus:border-blue-500" />
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveUpdate(t, { title: editTitle, description: editDesc })} className="text-xs bg-emerald-700 px-2 py-1 rounded text-white font-medium hover:bg-emerald-800">Save</button>
                        <button onClick={() => setEditingTaskId(null)} className="text-xs bg-gray-700 px-2 py-1 rounded text-white font-medium hover:bg-gray-600">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={t.is_completed} onChange={() => handleSaveUpdate(t, { is_completed: !t.is_completed })} className="mt-1 h-4 w-4 accent-emerald-500 cursor-pointer" disabled={viewScope === 'admin'} />
                      <div>
                        <h3 className={`text-sm font-medium ${t.is_completed ? 'line-through text-gray-500' : 'text-gray-200'}`}>{t.title}</h3>
                        {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                        <div className="flex gap-2 items-center mt-1">
                          <span className="text-[10px] text-gray-500">Time: {formatDate(t.created_at)}</span>
                          {viewScope === 'admin' && <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-900 px-1 rounded">User ID: {t.user_id}</span>}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {viewScope !== 'admin' && editingTaskId !== t.id && (
                    <div className="flex gap-2">
                      <button onClick={() => startEditing(t)} className="text-xs text-blue-400 bg-gray-800 px-2 py-1 rounded border border-gray-700 hover:bg-gray-700 transition">Edit</button>
                      <button onClick={() => handleDeleteTask(t.id)} className="text-xs text-red-400 bg-gray-800 px-2 py-1 rounded border border-gray-700 hover:bg-gray-700 transition">Delete</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);