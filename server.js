const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
const db = new sqlite3.Database('./backend_data/database.db');

app.use(express.static(path.join(__dirname, './')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// SIGNUP
app.post('/api/signup', (req, res) => {
    const { user_id, age, country } = req.body;

    db.run(
        "INSERT INTO users (user_id, age, country) VALUES (?, ?, ?)",
        [user_id, age, country.trim().toLowerCase()],
        (err) => {
            if (err) return res.status(400).send("This ID already exists!D ");
            res.sendStatus(201);
        }
    );
});

// MY PURCHASES
app.get('/api/my-purchases/:userId', (req, res) => {
    const uId = req.params.userId.trim();

    // returns purchased products for a user
    db.all(`
        SELECT p.*
        FROM behavior_15500 b
        JOIN products p ON p.product_id = b.product_id
        WHERE TRIM(CAST(b.user_id AS TEXT)) = ?
        AND CAST(b.purchased AS INTEGER) > 0
        ORDER BY b.rowid DESC
    `, [uId], (err, rows) => {
        res.json(rows || []);
    });
});

// PRODUCTS 
app.get('/api/products/:userId', (req, res) => {
    const uId = req.params.userId.trim();

    db.get(
        "SELECT age, country FROM users WHERE TRIM(CAST(user_id AS TEXT)) = ?",
        [uId],
        (err, user) => {
            if (!user) return res.json([]);

            // last 5 purchases used for similarity scoring
            const lastPurchaseQuery = `
                SELECT p.category, p.price
                FROM behavior_15500 b
                JOIN products p ON p.product_id = b.product_id
                WHERE TRIM(CAST(b.user_id AS TEXT)) = ?
                AND CAST(b.purchased AS INTEGER) > 0
                ORDER BY b.rowid DESC
                LIMIT 5
            `;

            db.all(lastPurchaseQuery, [uId], (err, lastPurchase) => {

                const query = `
                SELECT p.*, 
                    COALESCE(b.viewed,0) as viewed,
                    COALESCE(b.clicked,0) as clicks,
                    COALESCE(b.purchased,0) as is_bought,
                    COALESCE(r.rating,0) as my_rating,
                    COALESCE(s.hits,0) as social_hits,
                    COALESCE(g.global_avg, 0) as global_avg,
                    COALESCE(g.total_votes, 0) as total_votes
                FROM products p
                LEFT JOIN (
                    SELECT product_id,
                    SUM(viewed) as viewed,
                    SUM(clicked) as clicked,
                    SUM(purchased) as purchased
                    FROM behavior_15500
                    WHERE TRIM(CAST(user_id AS TEXT)) = ?
                    GROUP BY product_id
                ) b ON p.product_id = b.product_id
                LEFT JOIN (
                    SELECT product_id, MAX(rating) as rating
                    FROM ratings
                    WHERE TRIM(CAST(user_id AS TEXT)) = ?
                    GROUP BY product_id
                ) r ON p.product_id = r.product_id
                LEFT JOIN (
                    SELECT b2.product_id, COUNT(*) as hits
                    FROM behavior_15500 b2
                    JOIN users u2 ON b2.user_id = u2.user_id
                    WHERE 
                        LOWER(u2.country) = LOWER(?)
                        AND u2.user_id != ?
                        AND u2.age BETWEEN ? - 8 AND ? + 8
                        AND (CAST(b2.purchased AS INTEGER) > 0 OR CAST(b2.clicked AS INTEGER) > 2)
                    GROUP BY b2.product_id
                ) s ON p.product_id = s.product_id
                LEFT JOIN (
                    SELECT product_id, 
                        AVG(rating) as global_avg, 
                        COUNT(rating) as total_votes
                    FROM ratings
                    GROUP BY product_id
                ) g ON p.product_id = g.product_id
                `;

                db.all(query,
                    [uId, uId, user.country, uId, user.age, user.age],
                    (err, rows) => {

                        const results = rows
                        .filter(p => p.is_bought === 0)
                        .map(p => {
                            let score = 0;

                            // light weight for views (only signal awareness)
                            if (p.viewed) score += 1;

                            // strong engagement signals
                            if (p.clicks > 0) score += 300;
                            if (p.my_rating >= 4) score += 2000;

                            // social influence score
                            score += (p.social_hits || 0) * 25;

                            // global rating influence
                            const avg = p.global_avg || 0;
                            score += avg * 150;

                            if (p.total_votes >= 5 && avg >= 4) {
                                score += 500;
                            }

                            let strongMatch = false;

                            // similarity with recent purchases
                            if (lastPurchase && lastPurchase.length > 0) {
                                lastPurchase.forEach(lp => {
                                    const sameCategory = p.category === lp.category;
                                    const priceDiff = Math.abs(p.price - lp.price);

                                    if (sameCategory && priceDiff <= lp.price * 0.15) {
                                        score += 500;
                                        strongMatch = true;
                                    }
                                    else if (sameCategory) {
                                        score += 200;
                                    }
                                });
                            }

                            let rec_type = null;

                            if (strongMatch || p.clicks > 0 || p.my_rating >= 4 || p.viewed > 0) {
                                rec_type = 'personal';
                            }
                            else if (p.social_hits > 0 || (avg >= 4.2 && p.total_votes >= 5)) {
                                rec_type = 'trending';
                            }

                            return {
                                ...p,
                                final_score: score,
                                rec_type,
                                global_avg: avg.toFixed(1),
                                total_votes: p.total_votes || 0
                            };
                        });

                        // ranking logic (keeps high-rated and engaged items on top)
                        results.sort((a, b) => {
                            // 1
                            const aHated = a.my_rating > 0 && a.my_rating <= 2;
                            const bHated = b.my_rating > 0 && b.my_rating <= 2;
                            if (aHated && !bHated) return 1;
                            if (!aHated && bHated) return -1;
                        
                            // 2
                            const aRating = a.my_rating || 0;
                            const bRating = b.my_rating || 0;
                            if (aRating >= 4 && bRating < 4) return -1;
                            if (bRating >= 4 && aRating < 4) return 1;
                            if (aRating >= 4 && bRating >= 4 && bRating !== aRating) {
                                return bRating - aRating;
                            }
                        
                            // 3
                            if (b.final_score !== a.final_score) {
                                return b.final_score - a.final_score;
                            }
                        
                            // 4
                            if (a.rec_type === 'personal' && b.rec_type !== 'personal') return -1;
                            if (b.rec_type === 'personal' && a.rec_type !== 'personal') return 1;
                        
                            // 5
                            const aEng = (a.clicks || 0) * 2 + (a.viewed || 0);
                            const bEng = (b.clicks || 0) * 2 + (b.viewed || 0);
                            return bEng - aEng;
                        });
                        });

                        const finalResults = results.map((p, index) => {
                            if (index < 50) return p;
                            return { ...p, rec_type: null };
                        });

                        res.json(finalResults);
                    }
                );
            });
        }
    );
});

// INTERACT 
app.post('/api/interact', (req, res) => {
    const { user_id, product_id, action } = req.body;

    const col =
        action === 'view' ? 'viewed' :
        action === 'click' ? 'clicked' :
        action === 'purchased' ? 'purchased' :
        'viewed';

    // ensure row exists before updating
    db.run(
        `INSERT OR IGNORE INTO behavior_15500 
        (user_id, product_id, viewed, clicked, purchased)
        VALUES (?, ?, 0, 0, 0)`,
        [user_id, product_id],
        () => {
            db.run(
                `UPDATE behavior_15500 
                SET ${col} = COALESCE(${col}, 0) + 1
                WHERE CAST(user_id AS TEXT) = ? AND product_id = ?`,
                [user_id, product_id],
                () => res.sendStatus(200)
            );
        }
    );
});

// RATE
app.post('/api/rate', (req, res) => {
    const { user_id, product_id, rating } = req.body;

    db.run(
        "REPLACE INTO ratings (user_id, product_id, rating) VALUES (?, ?, ?)",
        [user_id, product_id, rating],
        () => res.sendStatus(200)
    );
});

// USERS
app.get('/api/users', (req, res) => {
    db.all("SELECT * FROM users", (err, rows) => res.json(rows || []));
});

// PURCHASES
app.get('/api/purchases/:userId', (req, res) => {
    const uId = req.params.userId.trim();

    db.all(`
        SELECT p.*
        FROM behavior_15500 b
        JOIN products p ON p.product_id = b.product_id
        WHERE TRIM(CAST(b.user_id AS TEXT)) = ?
        AND CAST(b.purchased AS INTEGER) = 1
        ORDER BY b.rowid DESC
    `, [uId], (err, rows) => {
        res.json(rows || []);
    });
});



app.listen(process.env.PORT || 3000, () => {
    console.log("Server is running...");
});