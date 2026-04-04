# 🚀 LAUNCH MONDAY - MINIMAL APPROACH

> **Only what's needed to go LIVE on Monday**  
> Everything else can be done later

---

## ✅ BEFORE MONDAY (Setup)

### 1. Create Production `.env` File (15 mins)
```bash
# Create: /home/ec2-user/rfp-app/.env.production

NODE_ENV=production
PORT=3000

# Database (you have this)
DATABASE_URL=postgresql://user:pass@prod-db-endpoint:5432/rfp_db

# API Keys (get from existing accounts)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# JWT Secret (GENERATE RANDOM - use this command)
# openssl rand -hex 32

JWT_SECRET=<generate-random-hex-32>

# AWS (you have bucket info)
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

**Generate JWT Secret:**
```bash
openssl rand -hex 32
# Copy output → JWT_SECRET value
```

---

### 2. Database Setup (10 mins)
```bash
# Connect to RDS instance
psql -h prod-db.rds.amazonaws.com -U admin -d rfp_db

# Enable pgvector extension (CRITICAL)
CREATE EXTENSION IF NOT EXISTS vector;

# Then exit
\q
```

---

### 3. Frontend Build (5 mins)
```bash
cd client
npm install
npm run build
# Output: client/dist/ folder created
```

---

### 4. EC2 Setup (30 mins)

```bash
# SSH into EC2
ssh -i your-key.pem ec2-user@your-ec2-ip

# Install dependencies
sudo yum update -y
sudo yum install nodejs npm -y
sudo yum install git -y

# Clone your repo
git clone <your-repo-url>
cd RFP-Automation

# Install packages
npm install

# Install PM2 (process manager)
sudo npm install -g pm2

# Create .env.production with values from step 1
nano .env.production
# Paste content → Ctrl+X → Y → Enter

# Run database migrations
NODE_ENV=production npm run migrate

# Create admin user
NODE_ENV=production node scripts/create-admin.js
# Follow prompts → email + password

# Start app with PM2
NODE_ENV=production pm2 start npm --name "rfp-app" -- start
pm2 save
pm2 startup
```

---

### 5. Reverse Proxy Setup (20 mins) - CRITICAL FOR HTTPS

**Install Nginx:**
```bash
sudo yum install nginx -y
```

**Create Nginx config:**
```bash
sudo nano /etc/nginx/conf.d/rfp.conf
```

**Paste this:**
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # Self-signed cert (temporary - replace later)
    ssl_certificate /etc/ssl/certs/rfp.crt;
    ssl_certificate_key /etc/ssl/private/rfp.key;

    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Generate self-signed certificate (temporary):**
```bash
sudo mkdir -p /etc/ssl/private
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/rfp.key \
  -out /etc/ssl/certs/rfp.crt \
  -subj "/CN=your-domain.com"
```

**Start Nginx:**
```bash
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

### 6. Security Groups (AWS) (5 mins)

In AWS Security Groups, allow:
```
- HTTP (80) from 0.0.0.0/0
- HTTPS (443) from 0.0.0.0/0
- PostgreSQL (5432) from EC2 security group only
```

---

### 7. DNS Setup (5 mins)

Point your domain to EC2 public IP:
```
A record: your-domain.com → EC2-IP
```

---

### 8. Test It (10 mins)

```bash
# From your local machine
curl https://your-domain.com/api/health

# Should return:
# {"status":"ok"}
```

---

## 📋 MINIMAL MONDAY CHECKLIST

- [ ] `.env.production` file created with all secrets
- [ ] Database migrations run (`npm run migrate`)
- [ ] Admin user created (`node scripts/create-admin.js`)
- [ ] Frontend built (`npm run build`)
- [ ] PM2 started on EC2
- [ ] Nginx installed and configured
- [ ] Self-signed SSL certificate generated
- [ ] Security groups configured
- [ ] DNS pointing to EC2
- [ ] Health check endpoint responding
- [ ] Can login to the app
- [ ] Can upload a test RFP file
- [ ] App is live! 🚀

**Setup time: ~2 hours total**

---

## 🔄 WHAT CAN BE DONE LATER (Post-Launch)

These are NOT needed for Monday:

- [ ] Real SSL certificate (use Let's Encrypt in Week 2)
- [ ] CloudWatch logging
- [ ] Error monitoring (Sentry)
- [ ] Email notifications
- [ ] Load balancer (if no scaling needed yet)
- [ ] Auto-scaling
- [ ] Redis caching
- [ ] CDN for assets
- [ ] Database backups automation (RDS default is OK for now)
- [ ] CI/CD pipeline
- [ ] Advanced security hardening
- [ ] Rate limiting (basic should work)
- [ ] Admin dashboard

---

## ⚠️ CRITICAL MUST-HAVES FOR LAUNCH

✅ **These MUST work:**
1. Database connection working
2. All environment variables set
3. Admin user created & can login
4. RFP file upload works
5. Image matching works
6. PPT generation works
7. HTTPS responding (even self-signed)
8. Health endpoint responds

✅ **NOT critical yet:**
- Email notifications
- Advanced logging
- Monitoring dashboards
- Auto-scaling
- Caching

---

## 📞 IF SOMETHING BREAKS MONDAY

```bash
# Check app logs
pm2 logs rfp-app

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# Restart app
pm2 restart rfp-app

# Restart Nginx
sudo systemctl restart nginx
```

---

## 🔐 WEEK 2 UPGRADES (Easy wins)

- [ ] Real SSL cert (Let's Encrypt - 5 mins)
- [ ] CloudWatch logs (10 mins)
- [ ] Email notifications (30 mins)
- [ ] Database automated backups (5 mins in RDS console)
- [ ] Sentry error monitoring (15 mins)

---

## 📊 EXPECTED PERFORMANCE (Monday launch)

- **Concurrent users**: ~10-20 (EC2 t3.medium)
- **RFP processing**: ~5 items/minute
- **Uptime**: 99%+ (single instance)
- **Database**: No issues with 1,478 products

**If you get more traffic:** Scale horizontally later with load balancer.

---

## ✨ FINAL NOTES

- **Monday 8am**: Start EC2 setup
- **Monday 12pm**: App should be live
- **Monday 5pm**: Full testing & monitoring
- **Week 2**: Polish & upgrades

**That's it! Deploy with confidence.** 🎯

