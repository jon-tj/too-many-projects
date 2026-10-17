using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class ShareLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlite = ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite";

            migrationBuilder.CreateTable(
                name: "ShareLinks",
                columns: table => new
                {
                    Token = table.Column<string>(type: sqlite ? "TEXT" : "character varying(32)", maxLength: 32, nullable: false),
                    ProjectId = table.Column<long>(type: sqlite ? "INTEGER" : "bigint", nullable: false),
                    BillId = table.Column<long>(type: sqlite ? "INTEGER" : "bigint", nullable: true),
                    Month = table.Column<string>(type: sqlite ? "TEXT" : "character varying(7)", maxLength: 7, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: sqlite ? "TEXT" : "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ShareLinks", x => x.Token);
                    table.ForeignKey(
                        name: "FK_ShareLinks_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ShareLinks_ProjectId",
                table: "ShareLinks",
                column: "ProjectId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ShareLinks");
        }
    }
}
