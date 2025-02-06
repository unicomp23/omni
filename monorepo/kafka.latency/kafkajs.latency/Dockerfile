FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run type-check

# Set the default command
ENTRYPOINT ["npm", "run", "start", "--"]