const express = require('express')
const cors = require('cors')
const mysql = require('mysql2')
require('dotenv').config()
const app = express()

app.use(cors())
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const connections = mysql.createConnection(process.env.DATABASE_URL)

app.post('/register', (req, res) =>{
    try {
        const {fName, lName, username, password, phone } = req.body;
        if(!fName || !lName || !username || !password || !phone) {
            return res.status(400).json({error: 'All fields are required'});
        }
        const accountNumber = Math.floor(1000000000 + Math.random() * 9000000000).toString();

        const query = 'INSERT INTO users (fName, lName, username, password, phone, account_number) VALUES (?, ?, ?, ?, ?, ?)';
        connections.query(query, [fName, lName, username, password, phone, accountNumber], (err, result) => {
            if (err) {
                console.error(err);
                return res.status(500).json({error: 'Database insert failed'});
            }
            res.json({message: 'User registered successfully', userId: result.insertId, accountNumber: accountNumber });
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error'});
    }
});

app.post('/login', (req, res) => {
    const {username, password } = req.body;
    if(!username || !password) {
        return res.status(400).json({error: 'Username and Password are required'});
    }
    const query = 'SELECT * FROM users WHERE username = ? OR phone = ?';
    connections.query(query, [username, username], async (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({error: 'Database query failed'});
        }
        if (results.length == 0) {
            return res.status(401).json({error: 'User does not exist! (Registration Required)'});
        }
        const user = results[0];
        if (password !== user.password) {
            return res.status(401).json({error:'Incorrect password'});
        }
        const { userID, fName, lName, username: uname, phone} = user;
        res.json({userID, fName, lName, username:uname, phone});

    } 
)
})

app.put('/password_reset', (req, res) => {
    const {username, newPassword} = req.body;
    if(!username || !newPassword) {
        return res.status(400).json({error: 'Username and new password are required'});
    }
    const query = 'UPDATE users SET password = ? WHERE username = ?';
    connections.query(query, [newPassword, username], (err, result) => {
        if(err) {
            console.error(err);
            return res.status(500).json({error: ''})
        }
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'Password updated successfully' });
    });
})

app.get('/transactions/:userId', (req, res) => {
    const {userId} = req.params;
    const query = `
    SELECT transaction_amount, type, description, created_at
    FROM transactions
    WHERE userID = ?
    ORDER BY created_at DESC
  `
  connections.query(query, [userId], (err, results) => {
    if(err) {
        console.error(err);
        return res.status(500).json({error: 'Database query failed'});
    }
    res.json({transactions: results});
  });
});

app.post('/qr/topup', (req, res) => {
  console.log("REQ BODY:", req.body);
  const { username, amount } = req.body;
  const amountNum = parseFloat(amount);

  if (!username || isNaN(amountNum) || amountNum <= 0) {
    return res.status(400).send("Invalid username or amount");
  }

  const getUserQuery = `SELECT userID, current_balance FROM users WHERE username = ?`;

  connections.query(getUserQuery, [username], (err, users) => {
    if (err) return res.status(500).send("Database error");
    if (users.length === 0) return res.status(404).send("User not found");

    const userIdNum = users[0].userID;

    const updateBalanceQuery = `UPDATE users SET current_balance = current_balance + ? WHERE userID = ?`;

    connections.query(updateBalanceQuery, [amountNum, userIdNum], (err, result) => {
      if (err) return res.status(500).send("Failed to update balance");

      const insertTransactionQuery = `
        INSERT INTO transactions (userID, transaction_amount, type, description, created_at)
        VALUES (?, ?, 'money_In', 'Top-up via QR', NOW())
      `;
      connections.query(insertTransactionQuery, [userIdNum, amountNum], (err, result) => {
        if (err) return res.status(500).send("Failed to insert transaction");

        connections.query('SELECT current_balance FROM users WHERE userID = ?', [userIdNum], (err, rows) => {
          if (err) return res.status(500).send("Failed to fetch updated balance");
          res.send(`Successfully added $${amountNum} to ${username}`);
        });
      });
    });
  });
});


app.get('/qr/topup', (req, res) => {
  const username = req.query.username;
  if(!username) return res.send("Invalid QR code");

  res.send(`
    <html>
      <body style="font-family:sans-serif; text-align:center; padding:50px;">
        <h2>Send Money to User ${username}</h2>
        <form action="/qr/topup" method="POST">
          <input type="hidden" name="username" value="${username}">
          <input type="number" name="amount" placeholder="Enter amount" required>
          <button type="submit">Send Money</button>
        </form>
      </body>
    </html>
  `);
});

app.get('/balance/:userID', (req, res) => {
  const { userID } = req.params;
  const query = 'SELECT current_balance, account_number FROM users WHERE userID = ?';
  connections.query(query, [userID], (err, results) => {
    if (err) return res.status(500).json({ error: 'Database query failed' });
    if (results.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(results[0]);
  });
});

app.post('/transfer', (req, res) => {
  const { senderId, recipientAccount, amount } = req.body;

  const transferAmount = parseFloat(amount);

  if (!senderId || !recipientAccount || isNaN(transferAmount) || transferAmount <= 0) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const getSenderQuery = 'SELECT username, current_balance FROM users WHERE userID = ?';
  connections.query(getSenderQuery, [senderId], (err, senderRows) => {
    if (err) return res.status(500).json({ error: "Database error" });
    if (!senderRows.length) return res.status(404).json({ error: "Sender not found" });

    const senderUsername = senderRows[0].username;
    const senderBalance = parseFloat(senderRows[0].current_balance);

    if (senderBalance < transferAmount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const getRecipientQuery = 'SELECT userID, username, current_balance FROM users WHERE account_number = ?';
    connections.query(getRecipientQuery, [recipientAccount], (err, recipientRows) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (!recipientRows.length) return res.status(404).json({ error: "Recipient not found" });

      const recipientId = recipientRows[0].userID;
      const recipientUsername = recipientRows[0].username;

      connections.beginTransaction(err => {
        if (err) return res.status(500).json({ error: "Transaction start failed" });

        const updateSender = 'UPDATE users SET current_balance = current_balance - ? WHERE userID = ?';
        connections.query(updateSender, [transferAmount, senderId], (err) => {
          if (err) return connections.rollback(() => res.status(500).json({ error: "Failed to update sender" }));

          const updateRecipient = 'UPDATE users SET current_balance = current_balance + ? WHERE userID = ?';
          connections.query(updateRecipient, [transferAmount, recipientId], (err) => {
            if (err) return connections.rollback(() => res.status(500).json({ error: "Failed to update recipient" }));

            const logSender = `
              INSERT INTO transactions (userID, transaction_amount, type, description, created_at)
              VALUES (?, ?, 'money_Out', 'Transfer to ${recipientUsername}', NOW())
            `;
            connections.query(logSender, [senderId, transferAmount], (err) => {
              if (err) return connections.rollback(() => res.status(500).json({ error: "Failed to log sender transaction" }));

              const logRecipient = `
                INSERT INTO transactions (userID, transaction_amount, type, description, created_at)
                VALUES (?, ?, 'money_In', 'Received from ${senderUsername}', NOW())
              `;
              connections.query(logRecipient, [recipientId, transferAmount], (err) => {
                if (err) return connections.rollback(() => res.status(500).json({ error: "Failed to log recipient transaction" }));

                connections.commit(err => {
                  if (err) return connections.rollback(() => res.status(500).json({ error: "Commit failed" }));

                  res.json({
                    message: `Successfully transferred $${transferAmount} to ${recipientUsername}`
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

app.get('/users/:username', (req, res) => {
  const { username } = req.params;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const query = 'SELECT username, fName, lName, phone, profileImage FROM users WHERE username = ?';
  connections.query(query, [username], (err, results) => {
    if (err) return res.status(500).json({ error: 'Failed to fetch user' });
    if (results.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(results[0]);
  });
});

app.put('/profile/update', (req, res) => {
  const { username, fName, lName, phone, profileImage } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const query = `UPDATE users SET fName = ?, lName = ?, phone = ?, profileImage = ? WHERE username = ?`;

  connections.query(query, [fName, lName, phone, profileImage, username], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to update user' });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User updated successfully' });
  });
});

app.post('/cards', (req, res) => {
  const { user_id, card_number, card_holder, expiry, cvv} = req.body;

  if (!user_id || !card_number || !card_holder || !expiry || !cvv) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const query = `INSERT INTO cards (userID, card_number, card_holder, expiry, cvv)
                 VALUES (?, ?, ?, ?, ?)`;

  connections.query(query, [user_id, card_number, card_holder, expiry, cvv], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to add card' });
    }
    res.json({ message: 'Card added successfully', cardId: result.insertId });
  });
});

// Get all cards for a user
app.get('/cards/:userId', (req, res) => {
  const { userId } = req.params;
  const query = `SELECT cardID, card_number, card_holder, expiry FROM cards WHERE userID = ?`;

  connections.query(query, [userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ cards: rows });
  });
});

// Delete a card
app.delete('/cards/:cardId', (req, res) => {
  const { cardId } = req.params;
  const query = `DELETE FROM cards WHERE cardID = ?`;

  connections.query(query, [cardId], (err, result) => {
    if (err) return res.status(500).json({ error: 'Failed to delete card' });
    res.json({ message: 'Card deleted successfully' });
  });
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running on port 3000`);
});


module.exports = app;
