import { prisma } from "../../lib/prisma.js";
import bcrypt from "bcrypt";

export async function registerUser(
    firstName: string,
    lastName: string,
    email: string,
    password: string
) {

    const existingUser = await prisma.user.findUnique({
        where: { email },
    });

    if (existingUser) {
        throw new Error("User already exists");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
        data: {
            firstName,
            lastName,
            email,
            passwordHash,
        },
        omit: {
            passwordHash: true,
        },
    });

    return user;
}


export async function loginUser(
  email: string,
  password: string
) {
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!user) {
    throw new Error("Invalid email or password");
  }

  const isPasswordValid = await bcrypt.compare(
    password,
    user.passwordHash
  );

  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  const { passwordHash, ...userWithoutPassword } = user;

  return userWithoutPassword;
}

export async function findUserById(id: number) {
  const user = await prisma.user.findFirst({
    where: {
      id,
    },
    omit: {
      passwordHash: true,
    },
  });

  if (!user) {
    throw new Error("No user found");
  }

  return user;
}
