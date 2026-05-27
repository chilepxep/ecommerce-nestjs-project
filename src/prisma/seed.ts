import 'dotenv/config';
import { HttpMethod, PrismaClient, RoleCode } from '@/generated/prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const permissions = [
  // Users
  {
    name: 'Xem danh sách user',
    apiPath: '/api/v1/users',
    method: HttpMethod.GET,
    module: 'USER',
  },
  {
    name: 'Xem chi tiết user',
    apiPath: '/api/v1/users/:id',
    method: HttpMethod.GET,
    module: 'USER',
  },
  {
    name: 'Cập nhật user',
    apiPath: '/api/v1/users/:id',
    method: HttpMethod.PATCH,
    module: 'USER',
  },
  {
    name: 'Xóa user',
    apiPath: '/api/v1/users/:id',
    method: HttpMethod.DELETE,
    module: 'USER',
  },

  // Roles
  {
    name: 'Xem danh sách role',
    apiPath: '/api/v1/roles',
    method: HttpMethod.GET,
    module: 'ROLE',
  },
  {
    name: 'Tạo role',
    apiPath: '/api/v1/roles',
    method: HttpMethod.POST,
    module: 'ROLE',
  },
  {
    name: 'Cập nhật role',
    apiPath: '/api/v1/roles/:id',
    method: HttpMethod.PATCH,
    module: 'ROLE',
  },
  {
    name: 'Xóa role',
    apiPath: '/api/v1/roles/:id',
    method: HttpMethod.DELETE,
    module: 'ROLE',
  },
  {
    name: 'Gán permission cho role',
    apiPath: '/api/v1/roles/:id/permissions',
    method: HttpMethod.PUT,
    module: 'ROLE',
  },
  {
    name: 'Gỡ permission khỏi role',
    apiPath: '/api/v1/roles/:id/permissions',
    method: HttpMethod.DELETE,
    module: 'ROLE',
  },

  // Permissions
  {
    name: 'Xem danh sách permission',
    apiPath: '/api/v1/permissions',
    method: HttpMethod.GET,
    module: 'PERMISSION',
  },
  {
    name: 'Tạo permission',
    apiPath: '/api/v1/permissions',
    method: HttpMethod.POST,
    module: 'PERMISSION',
  },
  {
    name: 'Cập nhật permission',
    apiPath: '/api/v1/permissions/:id',
    method: HttpMethod.PATCH,
    module: 'PERMISSION',
  },
  {
    name: 'Xóa permission',
    apiPath: '/api/v1/permissions/:id',
    method: HttpMethod.DELETE,
    module: 'PERMISSION',
  },
];

async function seedPermissions() {
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: {
        apiPath_method: {
          apiPath: perm.apiPath,
          method: perm.method,
        },
      },
      update: {
        name: perm.name,
        module: perm.module,
      },
      create: perm,
    });
  }

  console.log(`✅ Seeded permissions`);
}

async function seedRoles() {
  const roles = [
    { code: RoleCode.SUPER_ADMIN, name: 'Super Admin' },
    { code: RoleCode.ADMIN, name: 'Admin' },
    { code: RoleCode.MANAGER, name: 'Manager' },
    { code: RoleCode.CUSTOMER, name: 'Customer' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
      },
      create: role,
    });
  }

  console.log(`✅ Seeded roles`);
}

async function assignPermissionsToSuperAdmin() {
  const superAdmin = await prisma.role.findUnique({
    where: { code: RoleCode.SUPER_ADMIN },
  });

  if (!superAdmin) {
    throw new Error('SUPER_ADMIN role not found');
  }

  const permissions = await prisma.permission.findMany({
    select: { id: true },
  });

  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({
      roleId: superAdmin.id,
      permissionId: p.id,
    })),
    skipDuplicates: true,
  });

  console.log(`✅ Assigned ${permissions.length} permissions to SUPER_ADMIN`);
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await assignPermissionsToSuperAdmin();
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
