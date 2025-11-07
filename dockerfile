# Use a Debian-based Node.js image as the base
FROM node:lts-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
# This step is optimized for Docker caching
COPY package*.json ./

# Install any Node.js dependencies
RUN npm install

# Copy the rest of your application code to the working directory
COPY . .

# Expose the port your application listens on
EXPOSE 5500

# Command to run your application
CMD ["node", "server.js"]
