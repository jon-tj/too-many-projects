using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class Documents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";
            string Text(int? length = null) => sqlite ? "TEXT" : length is { } max ? $"character varying({max})" : "text";
            var integer = sqlite ? "INTEGER" : "bigint";
            var money = sqlite ? "TEXT" : "numeric";
            var moment = sqlite ? "TEXT" : "timestamp with time zone";

            migrationBuilder.AddColumn<string>(
                name: "BrandColor",
                table: "Projects",
                type: Text(7),
                maxLength: 7,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "BrandLogo",
                table: "Projects",
                type: Text(),
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Documents",
                columns: table => new
                {
                    Id = table.Column<long>(type: integer, nullable: false)
                        .Annotation("Sqlite:Autoincrement", true)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<long>(type: integer, nullable: false),
                    Type = table.Column<string>(type: Text(32), maxLength: 32, nullable: false),
                    Title = table.Column<string>(type: Text(200), maxLength: 200, nullable: false),
                    Status = table.Column<string>(type: Text(16), maxLength: 16, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: moment, nullable: false),
                    CreatedByUserId = table.Column<string>(type: Text(), nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: moment, nullable: false),
                    FinalizedAt = table.Column<DateTimeOffset>(type: moment, nullable: true),
                    RevisionOfId = table.Column<long>(type: integer, nullable: true),
                    ContentJson = table.Column<string>(type: Text(), nullable: false),
                    BrandingJson = table.Column<string>(type: Text(), nullable: true),
                    Number = table.Column<long>(type: integer, nullable: true),
                    Month = table.Column<string>(type: Text(7), maxLength: 7, nullable: true),
                    PaymentStatus = table.Column<string>(type: Text(16), maxLength: 16, nullable: true),
                    Amount = table.Column<decimal>(type: money, nullable: true),
                    AmountPaid = table.Column<decimal>(type: money, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Documents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Documents_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Documents_ProjectId",
                table: "Documents",
                column: "ProjectId");

            // Every bill becomes a finalized invoice, numbered as the bill was, with its report as its content, titled like new
            // invoices ("Invoice October 2026").
            migrationBuilder.Sql("""
                INSERT INTO "Documents" ("ProjectId", "Type", "Title", "Status", "CreatedAt", "CreatedByUserId", "UpdatedAt",
                    "FinalizedAt", "ContentJson", "Number", "Month", "PaymentStatus", "Amount", "AmountPaid")
                SELECT b."ProjectId", 'invoice',
                    'Invoice ' || CASE substr(b."Month", 6, 2) WHEN '01' THEN 'January' WHEN '02' THEN 'February' WHEN '03' THEN 'March' WHEN '04' THEN 'April' WHEN '05' THEN 'May' WHEN '06' THEN 'June' WHEN '07' THEN 'July' WHEN '08' THEN 'August' WHEN '09' THEN 'September' WHEN '10' THEN 'October' WHEN '11' THEN 'November' WHEN '12' THEN 'December' END || ' ' || substr(b."Month", 1, 4),
                    'final', b."CreatedAt", p."OwnerId", b."CreatedAt",
                    b."CreatedAt", b."ReportJson", b."Id", b."Month", b."Status", b."Amount", b."AmountPaid"
                FROM "Bills" b JOIN "Projects" p ON p."Id" = b."ProjectId";
                """);

            // Links to bills now point at their invoices. Links to a month's live report are removed: nothing live is
            // shared any more.
            migrationBuilder.AddColumn<long>(
                name: "DocumentId",
                table: "ShareLinks",
                type: integer,
                nullable: true);
            migrationBuilder.Sql("""
                UPDATE "ShareLinks" SET "DocumentId" = (
                    SELECT d."Id" FROM "Documents" d
                    WHERE d."ProjectId" = "ShareLinks"."ProjectId" AND d."Number" = "ShareLinks"."BillId");
                DELETE FROM "ShareLinks" WHERE "DocumentId" IS NULL;
                """);

            migrationBuilder.DropColumn(
                name: "BillId",
                table: "ShareLinks");

            migrationBuilder.DropColumn(
                name: "Month",
                table: "ShareLinks");

            migrationBuilder.AlterColumn<long>(
                name: "DocumentId",
                table: "ShareLinks",
                type: integer,
                nullable: false,
                oldClrType: typeof(long),
                oldType: integer,
                oldNullable: true);

            migrationBuilder.DropTable(
                name: "Bills");

            migrationBuilder.CreateIndex(
                name: "IX_ShareLinks_DocumentId",
                table: "ShareLinks",
                column: "DocumentId",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_ShareLinks_Documents_DocumentId",
                table: "ShareLinks",
                column: "DocumentId",
                principalTable: "Documents",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ShareLinks_Documents_DocumentId",
                table: "ShareLinks");

            migrationBuilder.DropTable(
                name: "Documents");

            migrationBuilder.DropIndex(
                name: "IX_ShareLinks_DocumentId",
                table: "ShareLinks");

            migrationBuilder.DropColumn(
                name: "DocumentId",
                table: "ShareLinks");

            migrationBuilder.DropColumn(
                name: "BrandColor",
                table: "Projects");

            migrationBuilder.DropColumn(
                name: "BrandLogo",
                table: "Projects");

            migrationBuilder.AddColumn<long>(
                name: "BillId",
                table: "ShareLinks",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Month",
                table: "ShareLinks",
                type: "TEXT",
                maxLength: 7,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Bills",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    ProjectId = table.Column<long>(type: "INTEGER", nullable: false),
                    Amount = table.Column<decimal>(type: "TEXT", nullable: false),
                    AmountPaid = table.Column<decimal>(type: "TEXT", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "TEXT", nullable: false),
                    Month = table.Column<string>(type: "TEXT", nullable: false),
                    ReportJson = table.Column<string>(type: "TEXT", nullable: false),
                    Status = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Bills", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Bills_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Bills_ProjectId",
                table: "Bills",
                column: "ProjectId");
        }
    }
}
