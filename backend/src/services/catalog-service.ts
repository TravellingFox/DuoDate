import { Prisma } from "@prisma/client";
import { conflict, notFound } from "../lib/errors";
import { prisma } from "../prisma";
import type {
  CategoryCreateInput,
  CategoryUpdateInput,
  SpaceCreateInput,
  SpaceUpdateInput,
} from "../types";

export function isGenericTravelSpaceName(name: string): boolean {
  return name.trim().toLowerCase() === "travel";
}

function translateUniqueError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    conflict("A record with that name already exists");
  }
  throw error;
}

export const catalogService = {
  async listSpaces(householdId: string) {
    const spaces = await prisma.space.findMany({
      where: { householdId, retiredAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return spaces.filter((space) => !isGenericTravelSpaceName(space.name));
  },

  async createSpace(householdId: string, input: SpaceCreateInput) {
    try {
      return await prisma.space.create({ data: { householdId, ...input } });
    } catch (error) {
      translateUniqueError(error);
    }
  },

  async updateSpace(householdId: string, id: string, input: SpaceUpdateInput) {
    const existing = await prisma.space.findFirst({ where: { id, householdId } });
    if (!existing) notFound("Space");
    try {
      return await prisma.space.update({ where: { id }, data: input });
    } catch (error) {
      translateUniqueError(error);
    }
  },

  async retireSpace(householdId: string, id: string) {
    const result = await prisma.space.updateMany({
      where: { id, householdId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    if (result.count === 0) notFound("Space");
  },

  listCategories(householdId: string) {
    return prisma.category.findMany({
      where: { householdId, deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  },

  async createCategory(householdId: string, input: CategoryCreateInput) {
    try {
      return await prisma.category.create({ data: { householdId, ...input } });
    } catch (error) {
      translateUniqueError(error);
    }
  },

  async updateCategory(householdId: string, id: string, input: CategoryUpdateInput) {
    const existing = await prisma.category.findFirst({ where: { id, householdId } });
    if (!existing) notFound("Category");
    try {
      return await prisma.category.update({ where: { id }, data: input });
    } catch (error) {
      translateUniqueError(error);
    }
  },

  async deleteCategory(householdId: string, id: string) {
    await prisma.$transaction(async (tx) => {
      const category = await tx.category.findFirst({ where: { id, householdId } });
      if (!category) notFound("Category");
      await tx.idea.updateMany({ where: { householdId, categoryId: id }, data: { categoryId: null } });
      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  },
};
