// Firebase Configuration (same as Hub)
const firebaseConfig = {
    apiKey: "AIzaSyDgecr5C7DnEyhtCx15zWU_v3D3jiHhH9I",
    authDomain: "kttc-hub-auth.firebaseapp.com",
    projectId: "kttc-hub-auth",
    storageBucket: "kttc-hub-auth.firebasestorage.app",
    messagingSenderId: "245328923618",
    appId: "1:245328923618:web:d3b96d7254ea334eedc7bb",
    databaseURL: "https://kttc-hub-auth-default-rtdb.firebaseio.com"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// Authenticate using custom token passed from hub
// The hub should get the user's ID token and exchange it for a custom token via backend
// Then pass that custom token as a URL parameter
async function authenticateWithCustomToken(customToken) {
    try {
        console.log('Attempting to sign in with custom token...');
        
        // Use token exactly as provided - Firebase custom tokens are JWTs
        // Only trim leading/trailing whitespace, don't modify the token itself
        let token = customToken;
        
        // Ensure it's a string
        if (typeof token !== 'string') {
            token = String(token);
        }
        
        // Trim only whitespace (JWTs shouldn't have any, but be safe)
        token = token.trim();
        
        // Validate token format (should be a JWT with exactly 3 parts)
        if (!token || token.length < 10) {
            throw new Error('Invalid custom token: token is too short or empty');
        }
        
        // Check if token looks like a JWT (must have exactly 3 parts separated by dots)
        const parts = token.split('.');
        if (parts.length !== 3) {
            console.error('Token does not have 3 JWT parts. Parts count:', parts.length);
            console.error('Token preview:', token.substring(0, 100));
            throw new Error('Invalid custom token format: expected JWT with 3 parts (header.payload.signature)');
        }
        
        console.log('Token validation passed. Length:', token.length);
        console.log('Token preview (first 50 chars):', token.substring(0, 50) + '...');
        console.log('JWT parts count:', parts.length);
        console.log('Firebase project ID (client):', firebaseConfig.projectId);
        console.log('Firebase API key (client):', firebaseConfig.apiKey.substring(0, 20) + '...');
        
        // Use the token exactly as-is - Firebase will validate it
        // Note: The token must be created for the same Firebase project as the client config
        console.log('Calling Firebase signInWithCustomToken...');
        const userCredential = await auth.signInWithCustomToken(token);
        console.log('Successfully authenticated with custom token:', userCredential.user.email);
        return userCredential.user;
    } catch (error) {
        console.error('Error signing in with custom token:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        throw error;
    }
}

// Configuration
// API endpoint - using relative path since frontend and API are on same origin
// The API supports:
// - POST /api/upload (multipart/form-data with file, postId, filename)
// - GET /api/files/:postId/:filename (download file)
// - DELETE /api/files/:postId/:filename (optional, for file deletion)
const API_BASE_URL = '/api';

// Version
const APP_VERSION = '1.0.0'; // Update this when deploying new versions

// Global state
let currentUser = null;
let userPermissions = null;
let isAdmin = false;
let allPosts = [];
let selectedFiles = [];
let pageShown = false;

// Check authentication and permissions
let authCheckTimeout = null;

// Show the page immediately when DOM is ready and check for custom token
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM loaded - showing page immediately');
    const loadingScreen = document.getElementById('loadingScreen');
    const mainApp = document.getElementById('mainApp');
    
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }
    if (mainApp) {
        mainApp.style.display = 'block';
        pageShown = true;
    }
    
    console.log('Page displayed - checking for authentication token...');
    
    // Check for ID token or custom token in URL when page loads (passed from hub)
    // The hub passes the ID token, which we exchange server-side for a custom token
    // to avoid mixed content issues (HTTPS hub -> HTTP social platform)
    const urlParams = new URLSearchParams(window.location.search);
    const idToken = urlParams.get('idToken');
    const customToken = urlParams.get('token'); // Legacy support
    
    if (idToken) {
        console.log('Found ID token in URL - exchanging for custom token...');
        try {
            // URLSearchParams.get() automatically decodes URL-encoded values
            // But let's ensure we have a valid token string
            const decodedIdToken = idToken.trim();
            
            if (!decodedIdToken || decodedIdToken.length < 10) {
                throw new Error('Invalid ID token: token appears to be empty or corrupted');
            }
            
            console.log('ID token extracted. Length:', decodedIdToken.length);
            console.log('ID token preview (first 50 chars):', decodedIdToken.substring(0, 50) + '...');
            
            // Exchange ID token for custom token via server (same origin, no mixed content)
            const response = await fetch(`${API_BASE_URL}/create-custom-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ idToken: decodedIdToken })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Server error response:', errorData);
                throw new Error(errorData.error || `Server returned status ${response.status}`);
            }
            
            const responseText = await response.text();
            console.log('Raw response text length:', responseText.length);
            console.log('Raw response preview (first 200 chars):', responseText.substring(0, 200));
            
            // Parse JSON manually to ensure no corruption
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
                throw new Error('Invalid JSON response from server');
            }
            
            console.log('Token exchange response received:', { 
                success: data.success, 
                hasCustomToken: !!data.customToken,
                customTokenType: typeof data.customToken
            });
            
            if (!data.success) {
                throw new Error(data.error || 'Server returned unsuccessful response');
            }
            
            if (!data.customToken) {
                throw new Error('Server response missing customToken field');
            }
            
            // Extract customToken exactly as returned - don't modify it
            // Firebase custom tokens are JWTs and must be used exactly as returned
            let customTokenString = data.customToken;
            
            // Only convert to string if it's not already a string (shouldn't happen, but safety check)
            if (typeof customTokenString !== 'string') {
                console.warn('Custom token is not a string, converting...', typeof customTokenString);
                customTokenString = String(customTokenString);
            }
            
            // Trim only leading/trailing whitespace (not internal spaces which shouldn't exist in JWTs)
            const originalLength = customTokenString.length;
            customTokenString = customTokenString.trim();
            if (originalLength !== customTokenString.length) {
                console.warn(`Token was trimmed: ${originalLength} -> ${customTokenString.length} chars`);
            }
            
            if (!customTokenString || customTokenString.length < 10) {
                throw new Error('Custom token from server is invalid: token is too short or empty');
            }
            
            // Validate it looks like a JWT (should have 3 parts separated by dots)
            const jwtParts = customTokenString.split('.');
            if (jwtParts.length !== 3) {
                console.error('Custom token does not have 3 JWT parts. Parts count:', jwtParts.length);
                console.error('Token preview:', customTokenString.substring(0, 100));
                throw new Error('Custom token format invalid: expected JWT with 3 parts');
            }
            
            // Check for any characters that shouldn't be in a JWT
            const invalidChars = customTokenString.match(/[^\w\-_.]/g);
            if (invalidChars && invalidChars.length > 0) {
                console.warn('Token contains potentially invalid characters:', invalidChars.slice(0, 10));
            }
            
            console.log('Custom token extracted successfully. Length:', customTokenString.length);
            console.log('Custom token preview (first 50 chars):', customTokenString.substring(0, 50) + '...');
            console.log('JWT parts count:', jwtParts.length);
            console.log('JWT part lengths:', jwtParts.map(p => p.length));
            
            console.log('Authenticating with custom token...');
            await authenticateWithCustomToken(customTokenString);
            
            // Clean up URL by removing token parameter
            const newUrl = window.location.href.split('?')[0];
            window.history.replaceState({}, document.title, newUrl);
            console.log('Successfully authenticated with custom token');
        } catch (error) {
            console.error('Failed to authenticate with ID token:', error);
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // Show error message and redirect to hub after a delay
            const loadingScreen = document.getElementById('loadingScreen');
            const mainApp = document.getElementById('mainApp');
            if (loadingScreen) loadingScreen.style.display = 'none';
            if (mainApp) mainApp.style.display = 'block';
            
            // Show error message
            alert(`Authentication failed: ${error.message}\n\nRedirecting to Hub...`);
            
            // Redirect to hub after showing error
            setTimeout(() => {
                window.location.href = 'https://webpubcontent.gray.tv/kttc/hub/kttc-hub.html';
            }, 2000);
        }
    } else if (customToken) {
        // Legacy support: direct custom token (if passed directly)
        console.log('Found custom token in URL - attempting to authenticate...');
        try {
            // URLSearchParams.get() automatically decodes, but ensure it's a string
            const decodedToken = String(customToken).trim();
            
            if (!decodedToken || decodedToken.length < 10) {
                throw new Error('Invalid custom token: token appears to be empty or corrupted');
            }
            
            console.log('Custom token extracted. Length:', decodedToken.length);
            await authenticateWithCustomToken(decodedToken);
            
            // Clean up URL by removing token parameter
            const newUrl = window.location.href.split('?')[0];
            window.history.replaceState({}, document.title, newUrl);
            console.log('Successfully authenticated with custom token');
        } catch (error) {
            console.error('Failed to authenticate with custom token:', error);
            console.error('Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            
            // Show error message and redirect to hub after a delay
            const loadingScreen = document.getElementById('loadingScreen');
            const mainApp = document.getElementById('mainApp');
            if (loadingScreen) loadingScreen.style.display = 'none';
            if (mainApp) mainApp.style.display = 'block';
            
            // Show error message
            alert(`Authentication failed: ${error.message}\n\nRedirecting to Hub...`);
            
            // Redirect to hub after showing error
            setTimeout(() => {
                window.location.href = 'https://webpubcontent.gray.tv/kttc/hub/kttc-hub.html';
            }, 2000);
        }
    } else {
        // No token in URL - check if user is already authenticated
        // If not, they should access through the hub
        console.log('No authentication token found in URL');
    }
});

auth.onAuthStateChanged(async (user) => {
    // Ensure page is shown (in case auth fires before DOMContentLoaded)
    if (!pageShown) {
        const loadingScreen = document.getElementById('loadingScreen');
        const mainApp = document.getElementById('mainApp');
        
        if (loadingScreen) loadingScreen.style.display = 'none';
        if (mainApp) {
            mainApp.style.display = 'block';
            pageShown = true;
        }
    }
    
    if (user) {
        currentUser = user;
        document.getElementById('userEmail').textContent = user.email;
        
        // Load user permissions
        userPermissions = await getUserPermissions(user.uid);
        
        console.log('Checking permissions for user:', user.email);
        console.log('User permissions object:', userPermissions);
        
        if (!userPermissions) {
            console.error('No user permissions found in database');
            showAccessDenied();
            return;
        }
        
        if (!userPermissions.permissions) {
            console.error('User permissions object exists but permissions property is missing');
            showAccessDenied();
            return;
        }
        
        // Check for social or socialAdmin permission
        // Handle both boolean true and string "true" cases
        const socialPerm = userPermissions.permissions.social;
        const socialAdminPerm = userPermissions.permissions.socialAdmin;
        const hasSocial = socialPerm === true || socialPerm === "true" || socialPerm === 1;
        const hasSocialAdmin = socialAdminPerm === true || socialAdminPerm === "true" || socialAdminPerm === 1;
        
        console.log('Social permission value:', socialPerm, 'Type:', typeof socialPerm);
        console.log('SocialAdmin permission value:', socialAdminPerm, 'Type:', typeof socialAdminPerm);
        console.log('Has social permission:', hasSocial);
        console.log('Has socialAdmin permission:', hasSocialAdmin);
        console.log('All permissions:', userPermissions.permissions);
        
        if (!hasSocial && !hasSocialAdmin) {
            console.error('User does not have social or socialAdmin permission');
            console.error('Available permissions:', Object.keys(userPermissions.permissions));
            console.error('Permission values:', {
                social: socialPerm,
                socialAdmin: socialAdminPerm,
                all: userPermissions.permissions
            });
            showAccessDenied();
            return;
        }
        
        isAdmin = hasSocialAdmin;
        
        // Check if user is editor (has social but not socialAdmin)
        const isEditor = hasSocial && !hasSocialAdmin;
        
        // Page is already shown, just update UI for authenticated user
        // Show editor welcome section if user is editor or admin
        if (isEditor || isAdmin) {
            showEditorWelcomeSection(userPermissions);
        }
        
        // Load initial data
        loadPosts();
    } else {
        // No authenticated user - page is already shown
        // Update UI to show authentication status
        const userEmailSpan = document.getElementById('userEmail');
        if (userEmailSpan) {
            userEmailSpan.textContent = 'Not authenticated';
        }
        
        console.log('No authenticated user - page is visible but features require authentication');
        // No redirect - page stays visible
    }
});

// Get user permissions
async function getUserPermissions(uid) {
    try {
        const snapshot = await database.ref(`users/${uid}`).once('value');
        const userData = snapshot.val();
        console.log('User permissions data:', userData);
        if (userData && userData.permissions) {
            console.log('Social permission:', userData.permissions.social);
            console.log('SocialAdmin permission:', userData.permissions.socialAdmin);
        }
        return userData;
    } catch (error) {
        console.error('Error getting permissions:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        return null;
    }
}

// Show access denied screen
function showAccessDenied() {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('accessDeniedScreen').style.display = 'flex';
}

// Show authentication required screen
function showAuthenticationRequired() {
    document.getElementById('loadingScreen').style.display = 'none';
    const authRequiredScreen = document.getElementById('authRequiredScreen');
    if (authRequiredScreen) {
        authRequiredScreen.style.display = 'flex';
    } else {
        // Fallback: show access denied screen with updated message
        const accessDeniedScreen = document.getElementById('accessDeniedScreen');
        const message = accessDeniedScreen.querySelector('p');
        const button = accessDeniedScreen.querySelector('button');
        
        if (message) {
            message.textContent = 'Please authenticate to access the Social Platform.';
        }
        
        // Update button to redirect to hub with return URL if accessing from Docker host
        if (button) {
            const isDockerHost = window.location.hostname.includes('kttc-dockerhost') || 
                                 window.location.hostname.includes('kttc.local');
            if (isDockerHost) {
                const returnUrl = encodeURIComponent(window.location.href);
                button.onclick = () => {
                    window.location.href = `https://webpubcontent.gray.tv/kttc/hub/kttc-hub.html?returnUrl=${returnUrl}`;
                };
            } else {
                button.onclick = () => {
                    window.location.href = 'https://webpubcontent.gray.tv/kttc/hub/kttc-hub.html';
                };
            }
        }
        
        accessDeniedScreen.style.display = 'flex';
    }
}

// Logout
function logout() {
    auth.signOut().then(() => {
        window.location.href = 'https://webpubcontent.gray.tv/kttc/hub/kttc-hub.html';
    }).catch((error) => {
        console.error('Error signing out:', error);
        alert('Error signing out. Please try again.');
    });
}


// Load posts
async function loadPosts() {
    const postsContainer = document.getElementById('postsContainer');
    postsContainer.innerHTML = '<p>Loading posts...</p>';
    
    try {
        const snapshot = await database.ref('socialPosts').once('value');
        const postsData = snapshot.val();
        
        if (!postsData) {
            postsContainer.innerHTML = '<p>No posts found. Upload your first post!</p>';
            allPosts = [];
            updateEditorWelcomeSection();
            return;
        }
        
        allPosts = Object.keys(postsData).map(postId => ({
            id: postId,
            ...postsData[postId]
        }));
        
        // Sort by uploadedAt (newest first)
        allPosts.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
        
        filterPosts();
        updateEditorWelcomeSection();
    } catch (error) {
        console.error('Error loading posts:', error);
        postsContainer.innerHTML = '<p style="color: #e74c3c;">Error loading posts. Please try again.</p>';
    }
}

// Filter posts and organize into swimlanes
function filterPosts() {
    const searchInput = document.getElementById('searchInput').value.toLowerCase();
    const postsContainer = document.getElementById('postsContainer');
    
    let filteredPosts = allPosts;
    
    // Filter by search
    if (searchInput) {
        filteredPosts = filteredPosts.filter(post => 
            post.title.toLowerCase().includes(searchInput) ||
            post.content.toLowerCase().includes(searchInput)
        );
    }
    
    // Organize posts by status
    const statusGroups = {
        pending: filteredPosts.filter(post => post.status === 'pending'),
        authorized: filteredPosts.filter(post => post.status === 'authorized'),
        changes_requested: filteredPosts.filter(post => post.status === 'changes_requested'),
        posted: filteredPosts.filter(post => post.status === 'posted')
    };
    
    // Create swimlanes for main dashboard (only pending, authorized, posted)
    const swimlanes = [
        { status: 'pending', title: '⏳ Pending', posts: statusGroups.pending },
        { status: 'authorized', title: '✅ Authorized', posts: statusGroups.authorized },
        { status: 'posted', title: '📤 Posted', posts: statusGroups.posted }
    ];
    
    // Display swimlanes
    if (filteredPosts.length === 0) {
        postsContainer.innerHTML = '<p style="text-align: center; padding: 3rem; color: #999;">No posts match your search.</p>';
        return;
    }
    
    postsContainer.innerHTML = swimlanes.map(swimlane => createSwimlane(swimlane)).join('');
}


// Create swimlane column
function createSwimlane(swimlane) {
    const statusClass = `swimlane-${swimlane.status}`;
    const postCount = swimlane.posts.length;
    
    return `
        <div class="swimlane ${statusClass}">
            <div class="swimlane-header">
                <div class="swimlane-title">${swimlane.title}</div>
                <span class="swimlane-count">${postCount}</span>
            </div>
            <div class="swimlane-content">
                ${postCount > 0 
                    ? swimlane.posts.map(post => createPostCard(post)).join('')
                    : '<div style="text-align: center; padding: 2rem; color: #999; font-size: 0.9rem;">No posts</div>'
                }
            </div>
        </div>
    `;
}

// Create post card
function createPostCard(post) {
    const scheduledDate = post.scheduledDate ? new Date(post.scheduledDate).toLocaleDateString() : 'Not set';
    const fileCount = post.files ? post.files.length : 0;
    
    return `
        <div class="post-card" onclick="viewPostDetail('${post.id}')">
            <div class="post-card-header">
                <div class="post-card-title">${escapeHtml(post.title || 'Untitled')}</div>
            </div>
            <div class="post-card-content">${escapeHtml(post.content || 'No content')}</div>
            <div class="post-card-meta">
                <div>📅 Scheduled: ${scheduledDate}</div>
                <div>👤 By: ${post.uploadedBy ? post.uploadedBy.email : 'Unknown'}</div>
                <div>📎 ${fileCount} file${fileCount !== 1 ? 's' : ''}</div>
            </div>
        </div>
    `;
}

// View post detail
async function viewPostDetail(postId) {
    const post = allPosts.find(p => p.id === postId);
    if (!post) {
        alert('Post not found');
        return;
    }
    
    const modal = document.getElementById('postDetailModal');
    const modalBody = document.getElementById('postDetailBody');
    
    modalBody.innerHTML = `
        <div class="post-detail-layout">
            <div class="post-detail-main">
                <div class="post-detail-section">
                    <h4>Title</h4>
                    <p id="detailTitle">${escapeHtml(post.title || 'Untitled')}</p>
                </div>
                <div class="post-detail-section">
                    <h4>Content</h4>
                    <p id="detailContent" class="clickable-content" onclick="showContentPreview('${post.id}')">${escapeHtml(post.content || 'No content')}</p>
                </div>
                <div class="post-detail-section">
                    <h4>Files</h4>
                    <div class="post-detail-files" id="postDetailFiles">
                        ${post.files && post.files.length > 0 ? 
                            post.files.map(file => createFileDisplay(file, post.id, post.status)).join('') 
                            : '<p>No files</p>'}
                    </div>
                </div>
            </div>
            <div class="post-detail-sidebar">
                ${canEditPost(post) || canDeletePost(post) || (isAdmin && post.status === 'pending') || (isAdmin && post.status === 'authorized') ? `
                <div class="post-detail-sidebar-actions">
                    ${canEditPost(post) ? `<button class="btn-primary btn-small" onclick="editPost('${post.id}')">Edit Post</button>` : ''}
                    ${canDeletePost(post) ? `<button class="btn-danger btn-small" onclick="deletePost('${post.id}')">Delete Post</button>` : ''}
                    ${isAdmin && post.status === 'pending' ? `<button class="btn-success btn-small" onclick="approvePost('${post.id}')">Approve</button>` : ''}
                    ${isAdmin && post.status === 'authorized' ? `<button class="btn-primary btn-small" onclick="markAsPosted('${post.id}')">Mark as Posted</button>` : ''}
                </div>
                ` : ''}
                <div class="post-detail-sidebar-section">
                    <h4>Status</h4>
                    <span class="status-badge status-${post.status}">${post.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                </div>
                ${post.platforms && post.platforms.length > 0 ? `
                <div class="post-detail-sidebar-section">
                    <h4>Platforms</h4>
                    <div class="platform-badges">
                        ${post.platforms.map(p => `<span class="platform-badge">${p.charAt(0).toUpperCase() + p.slice(1)}</span>`).join('')}
                    </div>
                </div>
                ` : ''}
                <div class="post-detail-sidebar-section">
                    <h4>Scheduled Date</h4>
                    <p>${formatDateLong(post.scheduledDate)}</p>
                </div>
                <div class="post-detail-sidebar-section">
                    <h4>Uploaded By</h4>
                    <p>${post.uploadedBy ? post.uploadedBy.email : 'Unknown'}</p>
                </div>
            </div>
        </div>
        ${post.changeRequests && post.changeRequests.length > 0 ? `
        <div class="post-detail-section-full">
            <h4>Change Requests</h4>
            <div class="change-requests-list">
                ${post.changeRequests.map(req => `
                    <div class="change-request-item">
                        <div class="change-request-item-header">
                            <span class="change-request-item-user">${req.requestedBy.email}</span>
                            <span class="change-request-item-time">${new Date(req.requestedAt).toLocaleString()}</span>
                        </div>
                        <div class="change-request-item-message">${escapeHtml(req.message)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        ${post.edits && post.edits.length > 0 ? `
        <div class="post-detail-section-full">
            <h4>Edit History</h4>
            <div class="edit-history">
                ${post.edits.map(edit => `
                    <div class="edit-history-item">
                        <div class="edit-history-item-header">
                            <span class="edit-history-item-user">${edit.editedBy.email}</span>
                            <span class="edit-history-item-time">${new Date(edit.editedAt).toLocaleString()}</span>
                        </div>
                        <div class="edit-history-item-changes">${escapeHtml(edit.changes)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        <div class="post-detail-actions">
        </div>
    `;
    
    modal.style.display = 'flex';
}

// Create file display
function createFileDisplay(file, postId, postStatus) {
    const isAuthorized = postStatus === 'authorized';
    const isPosted = postStatus === 'posted';
    const fileUrl = `${API_BASE_URL}/files/${postId}/${file.filename}`;
    
    let mediaElement = '';
    if (file.type && file.type.startsWith('image/')) {
        mediaElement = `<img src="${fileUrl}" alt="${escapeHtml(file.originalName)}" onerror="this.style.display='none'">`;
    } else if (file.type && file.type.startsWith('video/')) {
        mediaElement = `<video src="${fileUrl}" controls></video>`;
    } else {
        mediaElement = `<div style="padding: 2rem; text-align: center; background: #ecf0f1;">File Preview Not Available</div>`;
    }
    
    return `
        <div class="post-detail-file">
            ${mediaElement}
            <div class="post-detail-file-info">
                <div class="post-detail-file-name">${escapeHtml(file.originalName)}</div>
                <div class="post-detail-file-size">${formatFileSize(file.size)}</div>
            </div>
            ${isAuthorized ? `<button class="download-btn" onclick="downloadFile('${postId}', '${file.filename}', '${escapeHtml(file.originalName)}')">Download</button>` : ''}
            ${isPosted ? `<div style="padding: 0.5rem; color: #7f8c8d; font-size: 0.9rem; font-style: italic;">Files deleted after posting</div>` : ''}
        </div>
    `;
}

// Check if user can edit post
function canEditPost(post) {
    if (isAdmin) return true;
    if (post.uploadedBy && post.uploadedBy.uid === currentUser.uid && post.status === 'pending') return true;
    return false;
}

// Check if user can delete post
function canDeletePost(post) {
    if (isAdmin) return true;
    if (post.uploadedBy && post.uploadedBy.uid === currentUser.uid) return true;
    return false;
}

// Edit post
function editPost(postId) {
    const post = allPosts.find(p => p.id === postId);
    if (!post) return;
    
    // Format scheduled date for date input (YYYY-MM-DD)
    let scheduledDateValue = '';
    if (post.scheduledDate) {
        const date = new Date(post.scheduledDate);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        scheduledDateValue = `${year}-${month}-${day}`;
    }
    
    const modalBody = document.getElementById('postDetailBody');
    modalBody.innerHTML = `
        <form id="editPostForm" onsubmit="savePostEdit(event, '${postId}')">
            <div class="edit-form">
                <div class="form-group">
                    <label>Title *</label>
                    <input type="text" id="editTitle" value="${escapeHtml(post.title || '')}" required>
                </div>
                <div class="form-group">
                    <label>Content *</label>
                    <textarea id="editContent" rows="6" required>${escapeHtml(post.content || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>Scheduled Date *</label>
                    <input type="date" id="editScheduledDate" value="${scheduledDateValue}" required>
                </div>
                <button type="submit" class="btn-primary">Save Changes</button>
                <button type="button" class="btn-secondary" onclick="viewPostDetail('${postId}')">Cancel</button>
            </div>
        </form>
    `;
}

// Save post edit
async function savePostEdit(event, postId) {
    event.preventDefault();
    
    const title = document.getElementById('editTitle').value;
    const content = document.getElementById('editContent').value;
    
    // Get scheduled date and convert to timestamp (start of day)
    const editScheduledDateInput = document.getElementById('editScheduledDate');
    const dateValue = editScheduledDateInput.value;
    const scheduledDate = new Date(dateValue + 'T00:00:00').getTime();
    
    const post = allPosts.find(p => p.id === postId);
    if (!post) return;
    
    const changes = [];
    if (title !== post.title) changes.push(`Title: "${post.title}" → "${title}"`);
    if (content !== post.content) changes.push(`Content changed`);
    if (scheduledDate !== post.scheduledDate) changes.push(`Scheduled date changed`);
    
    try {
        const updates = {
            title: title,
            content: content,
            scheduledDate: scheduledDate
        };
        
        // Add to edit history
        if (!post.edits) post.edits = [];
        post.edits.push({
            editedBy: {
                uid: currentUser.uid,
                email: currentUser.email
            },
            editedAt: firebase.database.ServerValue.TIMESTAMP,
            changes: changes.join('; ')
        });
        updates.edits = post.edits;
        
        await database.ref(`socialPosts/${postId}`).update(updates);
        
        alert('Post updated successfully!');
        loadPosts();
        updateEditorWelcomeSection();
        viewPostDetail(postId);
    } catch (error) {
        console.error('Error updating post:', error);
        alert('Error updating post. Please try again.');
    }
}

// Confirmation modal state
let confirmCallback = null;
let confirmPostId = null;

// Show confirmation modal
function showConfirmModal(title, message, callback, postId = null) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    confirmCallback = callback;
    confirmPostId = postId;
    document.getElementById('confirmModal').style.display = 'flex';
}

// Close confirmation modal
function closeConfirmModal() {
    document.getElementById('confirmModal').style.display = 'none';
    confirmCallback = null;
    confirmPostId = null;
}

// Confirm action
function confirmAction() {
    if (confirmCallback) {
        confirmCallback(confirmPostId);
    }
    closeConfirmModal();
}

// Delete post
async function deletePost(postId) {
    showConfirmModal(
        'Delete Post',
        'Are you sure you want to delete this post? This action cannot be undone.',
        async (id) => {
            try {
                // Get post data to access files
                const postSnapshot = await database.ref(`socialPosts/${id}`).once('value');
                const post = postSnapshot.val();
                
                // Delete all associated files from server
                if (post && post.files && post.files.length > 0) {
                    console.log(`Deleting ${post.files.length} file(s) for post ${id}`);
                    
                    const deletePromises = post.files.map(async (file) => {
                        try {
                            const response = await fetch(`${API_BASE_URL}/files/${id}/${file.filename}`, {
                                method: 'DELETE'
                            });
                            
                            if (!response.ok) {
                                const errorData = await response.json().catch(() => ({}));
                                console.error(`Failed to delete file ${file.filename}:`, errorData);
                            } else {
                                console.log(`Deleted file: ${file.filename}`);
                            }
                        } catch (error) {
                            console.error(`Error deleting file ${file.filename}:`, error);
                        }
                    });
                    
                    await Promise.all(deletePromises);
                    console.log('All files deleted for post:', id);
                }
                
                // Delete from database
                await database.ref(`socialPosts/${id}`).remove();
                
                showNotification('Post deleted successfully!', 'success');
                closePostDetail();
                loadPosts();
                updateEditorWelcomeSection();
            } catch (error) {
                console.error('Error deleting post:', error);
                showNotification('Error deleting post. Please try again.', 'error');
            }
        },
        postId
    );
}

// Show notification
function showNotification(message, type = 'success') {
    // Remove existing notification if any
    const existingNotification = document.getElementById('notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'notification';
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Add to body
    document.body.appendChild(notification);
    
    // Trigger animation
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// Approve post
async function approvePost(postId) {
    try {
        const updates = {
            status: 'authorized',
            authorizedBy: {
                uid: currentUser.uid,
                email: currentUser.email
            },
            authorizedAt: firebase.database.ServerValue.TIMESTAMP
        };
        
        await database.ref(`socialPosts/${postId}`).update(updates);
        
        showNotification('Post approved', 'success');
        closePostDetail();
        loadPosts();
        updateEditorWelcomeSection();
    } catch (error) {
        console.error('Error approving post:', error);
        showNotification('Error approving post. Please try again.', 'error');
    }
}


// Mark as posted
async function markAsPosted(postId) {
    try {
        // Get post data to access files
        const postSnapshot = await database.ref(`socialPosts/${postId}`).once('value');
        const post = postSnapshot.val();
        
        if (!post) {
            showNotification('Post not found.', 'error');
            return;
        }
        
        // Delete all associated files from server
        if (post.files && post.files.length > 0) {
            console.log(`Deleting ${post.files.length} file(s) for post ${postId}`);
            
            const deletePromises = post.files.map(async (file) => {
                try {
                    const response = await fetch(`${API_BASE_URL}/files/${postId}/${file.filename}`, {
                        method: 'DELETE'
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        console.error(`Failed to delete file ${file.filename}:`, errorData);
                        // Continue even if one file fails
                    } else {
                        console.log(`Deleted file: ${file.filename}`);
                    }
                } catch (error) {
                    console.error(`Error deleting file ${file.filename}:`, error);
                    // Continue even if one file fails
                }
            });
            
            await Promise.all(deletePromises);
            console.log('All files deleted for post:', postId);
        }
        
        // Update post status
        const updates = {
            status: 'posted',
            postedBy: {
                uid: currentUser.uid,
                email: currentUser.email
            },
            postedAt: firebase.database.ServerValue.TIMESTAMP
        };
        
        await database.ref(`socialPosts/${postId}`).update(updates);
        
        showNotification('Post marked as posted!', 'success');
        loadPosts();
        updateEditorWelcomeSection();
        viewPostDetail(postId);
    } catch (error) {
        console.error('Error marking post as posted:', error);
        showNotification('Error marking post. Please try again.', 'error');
    }
}

// Close post detail modal
function closePostDetail() {
    document.getElementById('postDetailModal').style.display = 'none';
}

// Show content preview
function showContentPreview(postId) {
    // Find the post in allPosts
    const post = allPosts.find(p => p.id === postId);
    if (!post) {
        console.error('Post not found:', postId);
        return;
    }
    
    // Set title
    document.getElementById('contentPreviewTitle').textContent = `Content Preview: ${escapeHtml(post.title || 'Untitled')}`;
    
    // Set content with better formatting
    const contentBody = document.getElementById('contentPreviewBody');
    contentBody.innerHTML = `
        <div class="content-preview-text">${escapeHtml(post.content || 'No content').replace(/\n/g, '<br>')}</div>
    `;
    
    // Show modal
    document.getElementById('contentPreviewModal').style.display = 'flex';
}

// Close content preview
function closeContentPreview() {
    document.getElementById('contentPreviewModal').style.display = 'none';
}

// Open upload modal
function openUploadModal() {
    const modal = document.getElementById('uploadModal');
    modal.style.display = 'flex';
    
    // Set default scheduled date to today
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const scheduledDateInput = document.getElementById('scheduledDate');
    scheduledDateInput.value = `${year}-${month}-${day}`;
    
    // Reset form
    document.getElementById('uploadForm').reset();
    // Re-set the date after reset
    scheduledDateInput.value = `${year}-${month}-${day}`;
    // Uncheck all platform checkboxes
    document.getElementById('platform-facebook').checked = false;
    document.getElementById('platform-instagram').checked = false;
    document.getElementById('platform-youtube').checked = false;
    document.getElementById('platform-tiktok').checked = false;
    selectedFiles = [];
    document.getElementById('filePreview').innerHTML = '';
    document.getElementById('uploadStatus').innerHTML = '';
    document.getElementById('uploadProgress').style.display = 'none';
    
    // Initialize drag and drop
    initializeDragAndDrop();
    
    // Ensure form handler is set up
    setupUploadForm();
}

// Close upload modal
function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm').reset();
    selectedFiles = [];
    document.getElementById('filePreview').innerHTML = '';
    document.getElementById('uploadStatus').innerHTML = '';
    document.getElementById('uploadProgress').style.display = 'none';
}

// Download file
function downloadFile(postId, filename, originalName) {
    const fileUrl = `${API_BASE_URL}/files/${postId}/${filename}`;
    
    // Create temporary link and trigger download
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}


// Show editor welcome section (for both editors and admins)
function showEditorWelcomeSection(userPermissions) {
    const welcomeSection = document.getElementById('editorWelcomeSection');
    if (!welcomeSection) return;
    
    welcomeSection.style.display = 'block';
    
    // Extract first name from displayName
    const displayName = userPermissions.displayName || currentUser.displayName || currentUser.email;
    const firstName = displayName.split(' ')[0];
    
    const welcomeTitle = document.getElementById('editorWelcomeTitle');
    if (welcomeTitle) {
        welcomeTitle.textContent = `Welcome ${firstName}`;
    }
    
    // Show authorized posts stat for admins
    const authorizedPostsStat = document.getElementById('authorizedPostsStat');
    if (authorizedPostsStat) {
        authorizedPostsStat.style.display = isAdmin ? 'flex' : 'none';
    }
    
    // Update statistics
    updateEditorWelcomeSection();
}

// Update editor welcome section with post statistics
function updateEditorWelcomeSection() {
    const welcomeSection = document.getElementById('editorWelcomeSection');
    if (!welcomeSection || welcomeSection.style.display === 'none') return;
    
    // Count pending posts
    const pendingPosts = allPosts.filter(post => post.status === 'pending');
    const pendingCount = pendingPosts.length;
    
    const pendingCountElement = document.getElementById('editorPendingCount');
    if (pendingCountElement) {
        pendingCountElement.textContent = pendingCount;
    }
    
    // Count authorized posts (for admins)
    if (isAdmin) {
        const authorizedPosts = allPosts.filter(post => post.status === 'authorized');
        const authorizedCount = authorizedPosts.length;
        
        const authorizedCountElement = document.getElementById('editorAuthorizedCount');
        if (authorizedCountElement) {
            authorizedCountElement.textContent = authorizedCount;
        }
    }
    
    // Find next scheduled post
    const scheduledPosts = allPosts
        .filter(post => post.scheduledDate && (post.status === 'pending' || post.status === 'authorized'))
        .map(post => ({
            ...post,
            scheduledTime: post.scheduledDate
        }))
        .sort((a, b) => a.scheduledTime - b.scheduledTime);
    
    const nextScheduledElement = document.getElementById('editorNextScheduled');
    if (nextScheduledElement) {
        if (scheduledPosts.length > 0) {
            const nextPost = scheduledPosts[0];
            nextScheduledElement.textContent = formatDateLong(nextPost.scheduledTime);
        } else {
            nextScheduledElement.textContent = 'No posts scheduled';
        }
    }
}

// Format date as "Monday, Nov. 11"
function formatDateLong(date) {
    if (!date) return 'Not set';
    const d = new Date(date);
    const options = { weekday: 'long', month: 'short', day: 'numeric' };
    return d.toLocaleDateString('en-US', options);
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Initialize drag and drop handlers
let dragAndDropSetup = false;

function initializeDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    if (!dropZone || dragAndDropSetup) return;
    
    dragAndDropSetup = true;
    
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    // Highlight drop zone when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });
    
    // Remove highlight when item leaves drop zone
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });
    
    // Handle dropped files
    dropZone.addEventListener('drop', handleDrop, false);
    
    // Attach file input change handler
    const fileInput = document.getElementById('fileUpload');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            handleFiles(Array.from(e.target.files));
        });
    }
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight(e) {
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        dropZone.classList.add('drag-over');
    }
}

function unhighlight(e) {
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        dropZone.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = Array.from(dt.files);
    handleFiles(files);
}

// Handle upload form submission
let uploadFormSetup = false;

function setupUploadForm() {
    const uploadForm = document.getElementById('uploadForm');
    if (!uploadForm || uploadFormSetup) return;
    
    uploadFormSetup = true;
    uploadForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const title = document.getElementById('postTitle').value;
            const content = document.getElementById('postContent').value;
            const link = document.getElementById('postLink').value.trim();
            
            // Get scheduled date and convert to timestamp (start of day)
            const scheduledDateInput = document.getElementById('scheduledDate');
            const dateValue = scheduledDateInput.value;
            const scheduledDate = new Date(dateValue + 'T00:00:00').getTime();
            
            // Get selected platforms
            const platforms = [];
            if (document.getElementById('platform-facebook').checked) platforms.push('facebook');
            if (document.getElementById('platform-instagram').checked) platforms.push('instagram');
            if (document.getElementById('platform-youtube').checked) platforms.push('youtube');
            if (document.getElementById('platform-tiktok').checked) platforms.push('tiktok');
            
            if (selectedFiles.length === 0) {
                alert('Please select at least one file');
                return;
            }
            
            if (platforms.length === 0) {
                alert('Please select at least one social platform');
                return;
            }
            
            const statusDiv = document.getElementById('uploadStatus');
            const progressDiv = document.getElementById('uploadProgress');
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            
            statusDiv.innerHTML = '';
            progressDiv.style.display = 'block';
            progressFill.style.width = '0%';
            progressText.textContent = 'Uploading files...';
            
            try {
                console.log('Starting upload process...');
                console.log('API_BASE_URL:', API_BASE_URL);
                console.log('Selected files:', selectedFiles.length);
                
                // Create post record
                const postId = database.ref('socialPosts').push().key;
                console.log('Created post ID:', postId);
                
                // Upload files
                const uploadedFiles = [];
                const totalFiles = selectedFiles.length;
                
                for (let i = 0; i < selectedFiles.length; i++) {
                    const file = selectedFiles[i];
                    const filename = `${postId}_${Date.now()}_${i}_${file.name}`;
                    
                    console.log(`Uploading file ${i + 1} of ${totalFiles}: ${file.name}`);
                    progressText.textContent = `Uploading file ${i + 1} of ${totalFiles}...`;
                    progressFill.style.width = `${((i + 1) / totalFiles) * 100}%`;
                    
                    // Upload to local API
                    const formData = new FormData();
                    formData.append('file', file);
                    formData.append('postId', postId);
                    formData.append('filename', filename);
                    
                    console.log('Sending request to:', `${API_BASE_URL}/upload`);
                    console.log('FormData entries:', {
                        file: file.name,
                        postId: postId,
                        filename: filename
                    });
                    
                    try {
                        console.log('Attempting fetch to:', `${API_BASE_URL}/upload`);
                        
                        // Add timeout to fetch request
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
                        
                        const response = await fetch(`${API_BASE_URL}/upload`, {
                            method: 'POST',
                            body: formData,
                            signal: controller.signal
                        });
                        
                        clearTimeout(timeoutId);
                        
                        console.log('Response received. Status:', response.status);
                        console.log('Response ok:', response.ok);
                        console.log('Response headers:', response.headers);
                        
                        if (!response.ok) {
                            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                            console.error('Upload failed:', errorData);
                            throw new Error(`Failed to upload file: ${file.name}. ${errorData.error || response.statusText}`);
                        }
                        
                        const result = await response.json();
                        console.log(`File uploaded successfully:`, result);
                    
                        uploadedFiles.push({
                            filename: filename,
                            originalName: file.name,
                            type: file.type,
                            size: file.size,
                            uploadedAt: Date.now()
                        });
                    } catch (fetchError) {
                        console.error('Fetch error occurred:', fetchError);
                        console.error('Error type:', fetchError.name);
                        console.error('Error message:', fetchError.message);
                        console.error('Error stack:', fetchError.stack);
                        
                        // Check for mixed content issue (HTTPS page trying to access HTTP API)
                        const isHTTPS = window.location.protocol === 'https:';
                        const isHTTPAPI = API_BASE_URL.startsWith('http://');
                        const isMixedContent = isHTTPS && isHTTPAPI;
                        
                        if (fetchError.name === 'AbortError') {
                            throw new Error(`Upload timeout: The server did not respond within 30 seconds. Please check if the server is running on ${API_BASE_URL}`);
                        } else if (isMixedContent && (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError') || fetchError.name === 'TypeError')) {
                            throw new Error(`Mixed Content Error: This page is served over HTTPS but the API is HTTP. Browsers block HTTPS pages from accessing HTTP APIs for security. Solutions: 1) Use HTTPS for the API, 2) Use a reverse proxy, or 3) Access the page over HTTP instead of HTTPS.`);
                        } else if (fetchError.message.includes('Failed to fetch') || fetchError.message.includes('NetworkError')) {
                            throw new Error(`Network error: Could not connect to server at ${API_BASE_URL}. Please ensure the server is running and accessible from your network.`);
                        } else {
                            throw new Error(`Network error uploading file: ${file.name}. ${fetchError.message}`);
                        }
                    }
                }
                
                console.log('All files uploaded. Creating post in database...');
                
                // Create post in database
                const postData = {
                    title: title,
                    content: content,
                    scheduledDate: scheduledDate,
                    status: 'pending',
                    uploadedBy: {
                        uid: currentUser.uid,
                        email: currentUser.email
                    },
                    uploadedAt: firebase.database.ServerValue.TIMESTAMP,
                    files: uploadedFiles,
                    platforms: platforms
                };
                
                // Add link if provided
                if (link) {
                    postData.link = link;
                }
                
                await database.ref(`socialPosts/${postId}`).set(postData);
                console.log('Post created in database:', postId);
                
                progressDiv.style.display = 'none';
                statusDiv.innerHTML = '<div class="status-message status-success">Post uploaded successfully!</div>';
                
                // Reset form
                document.getElementById('uploadForm').reset();
                selectedFiles = [];
                document.getElementById('filePreview').innerHTML = '';
                
                // Re-set the date after reset
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                scheduledDateInput.value = `${year}-${month}-${day}`;
                
                // Uncheck all platform checkboxes
                document.getElementById('platform-facebook').checked = false;
                document.getElementById('platform-instagram').checked = false;
                document.getElementById('platform-youtube').checked = false;
                document.getElementById('platform-tiktok').checked = false;
                
                // Reload posts and close modal after delay
                setTimeout(() => {
                    loadPosts();
                    updateEditorWelcomeSection();
                    closeUploadModal();
                }, 1500);
                
            } catch (error) {
                console.error('Error uploading post:', error);
                console.error('Error stack:', error.stack);
                console.error('Error name:', error.name);
                progressDiv.style.display = 'none';
                statusDiv.innerHTML = `<div class="status-message status-error">Error: ${error.message}</div>`;
                alert(`Upload failed: ${error.message}\n\nCheck the browser console for more details.`);
            }
        });
}

// Set up form when page loads
document.addEventListener('DOMContentLoaded', function() {
    setupUploadForm();
    
    // Set version number
    const versionElement = document.getElementById('appVersion');
    if (versionElement) {
        versionElement.textContent = APP_VERSION;
    }
});

// Handle files (from both drag-drop and file input)
function handleFiles(files) {
    // Filter to only accept images and videos
    const validFiles = files.filter(file => 
        file.type.startsWith('image/') || file.type.startsWith('video/')
    );
    
    if (validFiles.length === 0) {
        alert('Please select only image or video files.');
        return;
    }
    
    if (validFiles.length < files.length) {
        alert(`Some files were ignored. Only ${validFiles.length} valid file(s) added.`);
    }
    
    // Add new files to existing selection (allow multiple drops)
    selectedFiles = [...selectedFiles, ...validFiles];
    displayFilePreview();
    
    // Update file input
    const fileInput = document.getElementById('fileUpload');
    const dataTransfer = new DataTransfer();
    selectedFiles.forEach(file => dataTransfer.items.add(file));
    fileInput.files = dataTransfer.files;
}

// Display file preview
function displayFilePreview() {
    const previewContainer = document.getElementById('filePreview');
    if (!previewContainer) return;
    
    previewContainer.innerHTML = '';
    
    selectedFiles.forEach((file, index) => {
        const previewItem = document.createElement('div');
        previewItem.className = 'file-preview-item';
        
        const reader = new FileReader();
        reader.onload = function(e) {
            if (file.type.startsWith('image/')) {
                previewItem.innerHTML = `
                    <img src="${e.target.result}" alt="${file.name}">
                    <div class="file-name">${escapeHtml(file.name)}</div>
                    <button class="remove-file" onclick="removeFile(${index})">&times;</button>
                `;
            } else if (file.type.startsWith('video/')) {
                previewItem.innerHTML = `
                    <video src="${e.target.result}" controls></video>
                    <div class="file-name">${escapeHtml(file.name)}</div>
                    <button class="remove-file" onclick="removeFile(${index})">&times;</button>
                `;
            } else {
                previewItem.innerHTML = `
                    <div style="padding: 2rem; text-align: center; background: #ecf0f1;">${escapeHtml(file.name)}</div>
                    <button class="remove-file" onclick="removeFile(${index})">&times;</button>
                `;
            }
        };
        reader.readAsDataURL(file);
        
        previewContainer.appendChild(previewItem);
    });
}

// Remove file from selection
function removeFile(index) {
    selectedFiles.splice(index, 1);
    displayFilePreview();
    
    // Update file input
    const fileInput = document.getElementById('fileUpload');
    const dataTransfer = new DataTransfer();
    selectedFiles.forEach(file => dataTransfer.items.add(file));
    fileInput.files = dataTransfer.files;
}


