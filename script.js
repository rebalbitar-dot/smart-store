let currentUser = null;
let allProducts = [];
let cart = [];
let activeCategory = 'all';

// SIGNUP
async function handleSignup() {
    const id = document.getElementById('newId').value;
    const age = document.getElementById('newAge').value;
    const country = document.getElementById('newCountry').value.trim().toLowerCase();

    if(!id || !age || !country) return alert("Please fill all fields!");

    const res = await fetch('https://smart-store-ailr.onrender.com/api/signup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ user_id: id, age, country })
    });

    if(res.ok) {
        alert("Account created successfully!");
        document.getElementById('userIdInput').value = id;
        handleAuth();
    } else {
        alert("This ID already exists!");
    }
}

// LOGIN / AUTH
async function handleAuth() {
    let uid = document.getElementById('userIdInput').value;

    if (!uid) {
        uid = localStorage.getItem('savedUserId');
    }

    if (!uid) return;

    const res = await fetch('https://smart-store-ailr.onrender.com/api/users');
    const users = await res.json();

    currentUser = users.find(u => String(u.user_id) === String(uid));

    if (!currentUser) {
        localStorage.removeItem('savedUserId');
        return alert("User not found!");
    }

    localStorage.setItem('savedUserId', uid);

    document.getElementById('page-auth').classList.add('d-none');
    document.getElementById('page-shop').classList.remove('d-none');
    document.getElementById('navShopBtn').classList.remove('d-none');
    document.getElementById('logoutBtn').classList.remove('d-none');
    document.getElementById('navPurchasesBtn').classList.remove('d-none');
    document.getElementById('cartBtn').classList.remove('d-none');

    document.getElementById('userInfoNav').innerText =
        `ID: ${currentUser.user_id} | ${currentUser.country.toUpperCase()}`;

    await renderProducts(true);
}

// VIEW TRACKING (IMPRESSION)
const viewedOnce = new Set();
let observer;

// IntersectionObserver for tracking product visibility
function setupViewObserver() {

    if (observer) observer.disconnect();

    const cards = document.querySelectorAll('.product-card');

    observer = new IntersectionObserver(async (entries) => {
        for (let entry of entries) {
            if (entry.isIntersecting) {

                const pid = entry.target.getAttribute('data-id');

                if (viewedOnce.has(pid)) continue;

                viewedOnce.add(pid);

                await fetch('https://smart-store-ailr.onrender.com/api/interact', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        user_id: currentUser.user_id,
                        product_id: pid,
                        action: 'view'
                    })
                });
            }
        }
    }, {
        threshold: 0.1
    });

    cards.forEach(card => observer.observe(card));
}

// RENDER PRODUCTS
async function renderProducts(refresh = false) {

    if(refresh) {
        const res = await fetch(`https://smart-store-ailr.onrender.com/api/products/${currentUser.user_id}`);
        allProducts = await res.json();

        const map = new Map();
        allProducts.forEach(p => map.set(p.product_id, p));
        allProducts = [...map.values()];

        renderFilters();
    }

    const grid = document.getElementById('productsGrid');

    let filtered = activeCategory === 'all'
        ? allProducts
        : allProducts.filter(p => p.category === activeCategory);

    filtered.sort((a, b) => {
        const priority = { 'personal': 1, 'trending': 2 };
        return (priority[a.rec_type] || 3) - (priority[b.rec_type] || 3);
    });

    grid.innerHTML = filtered.map(p => {

        let stars = '';
        const rating = Number(p.my_rating || 0);

        for(let i=1; i<=5; i++) {
            stars += `<span class="star ${i <= rating ? 'active' : ''}"
                      onclick="rate(${p.product_id}, ${i}, event)">★</span>`;
        }

        let badge = '';
        let style = '';

        if (p.rec_type === 'personal') {
            badge = '<span class="ia-badge-personal">✨ Recommended</span>';
            style = 'border:2px solid #3b82f6;';
        }
        else if (p.rec_type === 'trending') {
            badge = '<span class="ia-badge-country">🌍 Trending</span>';
        }

        return `
        <div class="col-md-4">
            <div class="product-card shadow"
                data-id="${p.product_id}"
                style="${style}"
                onclick="handleClick(${p.product_id})">

                ${badge}

                <div class="text-info-custom small mb-1">${p.category}</div>
                <h5 class="mb-2">Product #${p.product_id}</h5>

                <div class="mb-2">${stars}</div>

                <div class="d-flex justify-content-between align-items-center mt-2">
                    <span class="fs-5 fw-bold text-success">${p.price}$</span>

                    <div class="d-flex gap-2">
                        <button class="btn btn-success btn-sm"
                            onclick="event.stopPropagation(); addToCart(${p.product_id})">
                            🛒
                        </button>
                    </div>
                </div>
            </div>
        </div>
        `;
    }).join('');

    setupViewObserver();
}

// CLICK TRACKING
async function handleClick(pid) {

    await fetch('https://smart-store-ailr.onrender.com/api/interact', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            user_id: currentUser.user_id,
            product_id: pid,
            action: 'click'
        })
    });

    openModal(pid);

    setTimeout(() => renderProducts(true), 200);
}

// RATE PRODUCT
async function rate(pid, score, e) {
    e.stopPropagation();

    await fetch('https://smart-store-ailr.onrender.com/api/rate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            user_id: currentUser.user_id,
            product_id: pid,
            rating: score
        })
    });

    renderProducts(true);
}

// CART
function addToCart(pid) {
    const item = allProducts.find(p => p.product_id === pid);

    if (!cart.find(i => i.product_id === pid)) {
        cart.push(item);
    }

    document.getElementById('cartCount').innerText = cart.length;
    renderCart();
}

// RENDER CART
function renderCart() {
    const container = document.getElementById('cartItems');

    if(cart.length === 0) {
        container.innerHTML = '<p class="text-center">Cart is empty</p>';
        document.getElementById('cartTotal').innerText = "Total: 0 $";
        return;
    }

    container.innerHTML = cart.map(item => `
        <div class="col-12 mb-2 p-2 bg-dark border rounded d-flex justify-content-between">
            <span>Product #${item.product_id}</span>
            <span class="text-success">${item.price}$</span>
        </div>
    `).join('');

    document.getElementById('cartTotal').innerText =
        `Total: ${cart.reduce((s,i)=>s+i.price,0)} $`;
}

// CHECKOUT
async function handleCheckout() {

    if(cart.length === 0) return alert("Cart is empty!");

    for (let item of cart) {
        await fetch('https://smart-store-ailr.onrender.com/api/interact', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                user_id: currentUser.user_id,
                product_id: item.product_id,
                action: 'purchased'
            })
        });
    }

    alert("Purchase completed!");

    cart = [];
    document.getElementById('cartCount').innerText = 0;

    renderCart();
    await renderProducts(true);
}

// MODAL
function openModal(pid) {
    const p = allProducts.find(x => x.product_id === pid);

    document.getElementById('modalTitle').innerText =
        `Product details #${p.product_id}`;

    document.getElementById('modalBody').innerHTML = `
        <div class="text-center mb-4">
            <h1 class="text-success display-4 fw-bold">${p.price}$</h1>
            <p class="badge bg-info">${p.category}</p>
        </div>

        <div class="bg-dark p-3 rounded border border-warning mb-3">
            <h6 class="text-warning mb-2">⭐ Global rating:</h6>
            <div class="fs-4">${p.global_avg} <small class="fs-6 text-muted">/ 5</small></div>
            <small class="text-muted">Based on ${p.total_votes} votes</small>
        </div>
    `;

    document.getElementById('modalAddBtn').onclick = () => {
        addToCart(p.product_id);
    };

    new bootstrap.Modal(document.getElementById('productModal')).show();
}

// FILTERS
function renderFilters() {
    const cats = ['all', ...new Set(allProducts.map(p => p.category))];

    document.getElementById('categoryFilters').innerHTML =
        cats.map(c =>
            `<button class="btn btn-sm m-1 ${activeCategory === c ? 'btn-primary' : 'btn-outline-primary'}"
             onclick="activeCategory='${c}'; renderProducts();">
             ${c === 'all' ? 'All' : c}
             </button>`
        ).join('');
}

// PURCHASES PAGE
async function showPurchases() {
    document.getElementById('page-shop').classList.add('d-none');
    document.getElementById('page-purchases').classList.remove('d-none');

    // show back button to shop
    document.getElementById('navShopBtn').classList.remove('d-none');

    const res = await fetch(`https://smart-store-ailr.onrender.com/api/purchases/${currentUser.user_id}`);
    const data = await res.json();

    const grid = document.getElementById('purchasesGrid');

    if (!data.length) {
        grid.innerHTML = '<p class="text-center">No purchases</p>';
        return;
    }

    grid.innerHTML = data.map(p => `
        <div class="col-md-4">
            <div class="product-card shadow border border-success">
                <h5>Product #${p.product_id}</h5>
                <div class="text-success">${p.price}$</div>
            </div>
        </div>
    `).join('');
}

// BACK TO SHOP
function backToShop() {
    document.getElementById('page-purchases').classList.add('d-none');
    document.getElementById('page-shop').classList.remove('d-none');
}

// LOGOUT
function handleLogout() {
    localStorage.removeItem('savedUserId');
    currentUser = null;
    cart = [];
    location.reload();

    document.getElementById('cartBtn').classList.add('d-none');
    document.getElementById('navShopBtn').classList.add('d-none');
}

// AUTO LOGIN
window.onload = () => {
    const savedId = localStorage.getItem('savedUserId');
    if (savedId) {
        document.getElementById('userIdInput').value = savedId;
        handleAuth();
    }
};