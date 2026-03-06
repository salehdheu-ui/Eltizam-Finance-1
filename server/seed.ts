import { storage } from "./storage";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function seed() {
  console.log("Seeding database...");

  // Check if admin user exists
  const existingUser = await storage.getUserByUsername("admin");
  
  if (existingUser) {
    console.log("Admin user already exists, skipping seed.");
    return;
  }

  // Create default admin user
  const hashedPassword = await hashPassword("admin");
  
  const user = await storage.createUser({
    username: "admin",
    password: hashedPassword,
    name: "المسؤول",
    email: "admin@eltizam.app",
  });

  console.log(`Created admin user with ID: ${user.id}`);

  // Create default categories
  const defaultCategories = [
    { name: "الراتب", type: "income", icon: "💰", color: "bg-green-100 text-green-600", budget: 0 },
    { name: "الإيجار", type: "expense", icon: "🏠", color: "bg-blue-100 text-blue-600", budget: 0 },
    { name: "الطعام", type: "expense", icon: "🍔", color: "bg-orange-100 text-orange-600", budget: 0 },
    { name: "المواصلات", type: "expense", icon: "🚗", color: "bg-purple-100 text-purple-600", budget: 0 },
    { name: "الصحة", type: "expense", icon: "🏥", color: "bg-red-100 text-red-600", budget: 0 },
    { name: "التعليم", type: "expense", icon: "📚", color: "bg-indigo-100 text-indigo-600", budget: 0 },
    { name: "الترفيه", type: "expense", icon: "🎮", color: "bg-pink-100 text-pink-600", budget: 0 },
    { name: "التسوق", type: "expense", icon: "🛍️", color: "bg-yellow-100 text-yellow-600", budget: 0 },
  ];

  for (const category of defaultCategories) {
    await storage.createCategory(user.id, category);
  }

  console.log(`Created ${defaultCategories.length} default categories`);

  // Create default wallet
  const wallet = await storage.createWallet(user.id, {
    name: "المحفظة الرئيسية",
    type: "cash",
    balance: 0,
    color: "from-emerald-600 to-emerald-800",
  });

  console.log(`Created default wallet with ID: ${wallet.id}`);
  console.log("Seeding completed successfully!");
}

seed().catch(console.error);
