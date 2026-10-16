using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class Reviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.CreateTable(
                name: "Reviews",
                columns: table => new
                {
                    Id = table.Column<long>(type: sqlite ? "INTEGER" : "bigint", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<string>(type: sqlite ? "TEXT" : "text", nullable: false),
                    Round = table.Column<int>(type: sqlite ? "INTEGER" : "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: false),
                    Dismissed = table.Column<bool>(type: sqlite ? "INTEGER" : "boolean", nullable: false),
                    Stars = table.Column<int>(type: sqlite ? "INTEGER" : "integer", nullable: true),
                    Body = table.Column<string>(type: sqlite ? "TEXT" : "character varying(2000)", maxLength: 2000, nullable: false),
                    MayPublish = table.Column<bool>(type: sqlite ? "INTEGER" : "boolean", nullable: false),
                    ProjectName = table.Column<string>(type: sqlite ? "TEXT" : "character varying(120)", maxLength: 120, nullable: true),
                    Featured = table.Column<bool>(type: sqlite ? "INTEGER" : "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Reviews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Reviews_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_UserId_Round",
                table: "Reviews",
                columns: new[] { "UserId", "Round" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Reviews");
        }
    }
}
